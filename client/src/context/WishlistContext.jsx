import { createContext, useCallback, useContext, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router-dom';
import { api, unwrap } from '../lib/api';
import { useAuth } from './AuthContext';
import { useToast } from './ToastContext';

const WishlistContext = createContext(null);

export function WishlistProvider({ children }) {
  const { isAuthenticated } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['wishlist'],
    queryFn: async () => unwrap(await api.get('/wishlist')),
    enabled: isAuthenticated,
  });

  const ids = useMemo(() => new Set((query.data || []).map((p) => p.id)), [query.data]);

  const toggle = useCallback(
    async (product) => {
      if (!isAuthenticated) {
        toast.info('Sign in to save books to your wishlist.', {
          action: { label: 'Sign in', onClick: () => navigate('/login', { state: { from: location } }) },
        });
        return;
      }
      const saved = ids.has(product.id);
      // Optimistic update for instant feedback
      const previous = queryClient.getQueryData(['wishlist']) || [];
      queryClient.setQueryData(['wishlist'], saved ? previous.filter((p) => p.id !== product.id) : [product, ...previous]);
      try {
        const data = unwrap(saved ? await api.delete(`/wishlist/${product.id}`) : await api.post(`/wishlist/${product.id}`));
        queryClient.setQueryData(['wishlist'], data);
        toast.success(saved ? 'Removed from wishlist' : `Saved “${product.title}” to your wishlist`);
      } catch (err) {
        queryClient.setQueryData(['wishlist'], previous);
        toast.error(err.message);
      }
    },
    [isAuthenticated, ids, queryClient, toast, navigate, location],
  );

  const value = { items: query.data || [], isLoading: query.isLoading, error: query.error, has: (id) => ids.has(id), toggle, count: ids.size };
  return <WishlistContext.Provider value={value}>{children}</WishlistContext.Provider>;
}

export const useWishlist = () => useContext(WishlistContext);
