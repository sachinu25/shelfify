import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from '../lib/api';
import { readJSON, remove, writeJSON } from '../lib/storage';
import { useAuth } from './AuthContext';
import { useToast } from './ToastContext';

const CartContext = createContext(null);
const GUEST_KEY = 'sf_guest_cart';
const COUPON_KEY = 'sf_coupon';
const MAX_QTY = 10;

/**
 * Unified cart for guests (persisted in localStorage, priced by the server's
 * /cart/quote endpoint) and signed-in users (persisted server-side). The guest
 * cart is merged into the account cart right after sign-in.
 */
export function CartProvider({ children }) {
  const { isAuthenticated, status } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [guestItems, setGuestItems] = useState(() => readJSON(GUEST_KEY, []));
  const [coupon, setCouponState] = useState(() => readJSON(COUPON_KEY, ''));
  const [pending, setPending] = useState(new Set());
  const mergedRef = useRef(false);
  const [mergeFailed, setMergeFailed] = useState(false);

  // While a guest bag is waiting to be merged, the account cart is not authoritative:
  // hold the account-cart query until the merge settles (avoids a stale pre-merge read).
  const merging = isAuthenticated && guestItems.length > 0 && !mergeFailed;

  useEffect(() => {
    writeJSON(GUEST_KEY, guestItems);
  }, [guestItems]);

  const setCoupon = useCallback((code) => {
    const v = (code || '').trim().toUpperCase();
    setCouponState(v);
    if (v) writeJSON(COUPON_KEY, v);
    else remove(COUPON_KEY);
  }, []);

  const serverCart = useQuery({
    queryKey: ['cart', 'server', coupon],
    queryFn: async () => unwrap(await api.get('/cart', { params: coupon ? { coupon } : {} })),
    enabled: isAuthenticated && !merging,
    placeholderData: keepPreviousData,
  });

  const guestCart = useQuery({
    queryKey: ['cart', 'guest', guestItems, coupon],
    queryFn: async () => unwrap(await api.post('/cart/quote', { items: guestItems, coupon: coupon || undefined })),
    enabled: status === 'guest' && guestItems.length > 0,
    placeholderData: keepPreviousData,
  });

  /**
   * Merge the guest bag into the account cart. Retries transient failures and never
   * discards the guest bag on failure: it stays saved locally and can be retried.
   */
  const mergeGuestCart = useCallback(async () => {
    const items = readJSON(GUEST_KEY, []);
    if (!items.length) return;
    setMergeFailed(false);
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const data = unwrap(await api.post('/cart/merge', { items }));
        // The merge response is the authoritative (coupon-less) account cart.
        queryClient.setQueryData(['cart', 'server', ''], data);
        setGuestItems([]);
        remove(GUEST_KEY);
        toast.info('Items from your guest bag were added to your account.');
        return;
      } catch (err) {
        console.warn(`[cart] guest bag merge attempt ${attempt} failed:`, err?.message);
        const retryable = !err?.status || err.status >= 500 || err.status === 429;
        if (!retryable || attempt === 3) break;
        await new Promise((r) => setTimeout(r, 400 * attempt));
      }
    }
    setMergeFailed(true);
    toast.warning('We couldn’t add your guest bag to your account yet. Your books are still saved.', {
      duration: 10000,
      action: { label: 'Try again', onClick: () => mergeGuestCart() },
    });
  }, [queryClient, toast]);

  // Merge once per sign-in.
  useEffect(() => {
    if (!isAuthenticated) {
      mergedRef.current = false;
      setMergeFailed(false);
      return;
    }
    if (mergedRef.current) return;
    mergedRef.current = true;
    mergeGuestCart();
  }, [isAuthenticated, mergeGuestCart]);

  const setServerData = useCallback(
    (data) => {
      // Mutation responses are priced without a coupon; refetch when one is applied.
      if (coupon) queryClient.invalidateQueries({ queryKey: ['cart', 'server'] });
      else queryClient.setQueryData(['cart', 'server', ''], data);
    },
    [queryClient, coupon],
  );

  const withPending = useCallback(async (id, fn) => {
    setPending((s) => new Set(s).add(id));
    try {
      return await fn();
    } finally {
      setPending((s) => {
        const n = new Set(s);
        n.delete(id);
        return n;
      });
    }
  }, []);

  const addItem = useCallback(
    async (product, quantity = 1) => {
      const id = product.id;
      return withPending(id, async () => {
        try {
          if (isAuthenticated) {
            const data = unwrap(await api.post('/cart/items', { productId: id, quantity }));
            setServerData(data);
          } else {
            setGuestItems((items) => {
              const existing = items.find((i) => i.productId === id);
              if (existing) return items.map((i) => (i.productId === id ? { ...i, quantity: Math.min(MAX_QTY, i.quantity + quantity) } : i));
              return [...items, { productId: id, quantity: Math.min(MAX_QTY, quantity) }];
            });
          }
          toast.success(`“${product.title}” added to your bag`);
          return true;
        } catch (err) {
          toast.error(err.message);
          return false;
        }
      });
    },
    [isAuthenticated, setServerData, toast, withPending, coupon, queryClient],
  );

  const updateQuantity = useCallback(
    async (productId, quantity) => {
      const q = Math.max(1, Math.min(MAX_QTY, quantity));
      return withPending(productId, async () => {
        try {
          if (isAuthenticated) {
            const data = unwrap(await api.patch(`/cart/items/${productId}`, { quantity: q }));
            setServerData(data);
          } else {
            setGuestItems((items) => items.map((i) => (i.productId === productId ? { ...i, quantity: q } : i)));
          }
        } catch (err) {
          toast.error(err.message);
        }
      });
    },
    [isAuthenticated, setServerData, toast, withPending, coupon, queryClient],
  );

  const removeItem = useCallback(
    async (productId, { silent = false } = {}) =>
      withPending(productId, async () => {
        try {
          if (isAuthenticated) {
            setServerData(unwrap(await api.delete(`/cart/items/${productId}`)));
          } else {
            setGuestItems((items) => items.filter((i) => i.productId !== productId));
          }
          if (!silent) toast.info('Removed from your bag');
        } catch (err) {
          toast.error(err.message);
        }
      }),
    [isAuthenticated, setServerData, toast, withPending, coupon, queryClient],
  );

  const clear = useCallback(async () => {
    if (isAuthenticated) setServerData(unwrap(await api.delete('/cart')));
    else setGuestItems([]);
  }, [isAuthenticated, setServerData]);

  const refresh = useCallback(() => queryClient.invalidateQueries({ queryKey: ['cart'] }), [queryClient]);

  const active = isAuthenticated ? serverCart : guestCart;
  const emptyCart = { items: [], issues: [], coupon: null, couponError: null, summary: null };
  const data = isAuthenticated ? serverCart.data || emptyCart : guestItems.length ? guestCart.data || emptyCart : emptyCart;

  const useServer = isAuthenticated && !merging;
  const count = useServer
    ? (serverCart.data?.items || []).reduce((n, i) => n + i.quantity, 0)
    : guestItems.reduce((n, i) => n + i.quantity, 0);

  const ids = useMemo(
    () => new Set(useServer ? (serverCart.data?.items || []).map((i) => i.product.id) : guestItems.map((i) => i.productId)),
    [useServer, serverCart.data, guestItems],
  );

  const value = {
    cart: data,
    count,
    isLoading: status === 'loading' || merging || (active.isLoading && (isAuthenticated || guestItems.length > 0)),
    isFetching: active.isFetching,
    error: active.error,
    coupon,
    setCoupon,
    addItem,
    updateQuantity,
    removeItem,
    clear,
    refresh,
    has: (id) => ids.has(id),
    isPending: (id) => pending.has(id),
  };

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export const useCart = () => useContext(CartContext);
