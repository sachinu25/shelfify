import { lazy, Suspense } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';
import { GuestOnly, RequireAdmin, RequireAuth, ScrollToTop, SiteLayout } from './components/layout/Guards';
import { ErrorBoundary } from './components/ErrorBoundary';
import { PageLoader } from './components/ui';
import Home from './pages/Home';

const Shop = lazy(() => import('./pages/Shop'));
const ProductDetail = lazy(() => import('./pages/ProductDetail'));
const Cart = lazy(() => import('./pages/Cart'));
const Checkout = lazy(() => import('./pages/Checkout'));
const Orders = lazy(() => import('./pages/Orders'));
const OrderDetail = lazy(() => import('./pages/OrderDetail'));
const Wishlist = lazy(() => import('./pages/Wishlist'));
const Account = lazy(() => import('./pages/Account'));
const NotFound = lazy(() => import('./pages/NotFound'));
const About = lazy(() => import('./pages/About'));
const Login = lazy(() => import('./pages/Auth').then((m) => ({ default: m.Login })));
const Register = lazy(() => import('./pages/Auth').then((m) => ({ default: m.Register })));
const ForgotPassword = lazy(() => import('./pages/Auth').then((m) => ({ default: m.ForgotPassword })));
const ResetPassword = lazy(() => import('./pages/Auth').then((m) => ({ default: m.ResetPassword })));

const AdminLayout = lazy(() => import('./pages/admin/AdminLayout'));
const AdminDashboard = lazy(() => import('./pages/admin/Dashboard'));
const AdminProducts = lazy(() => import('./pages/admin/Products'));
const AdminInventory = lazy(() => import('./pages/admin/Inventory'));
const AdminOrders = lazy(() => import('./pages/admin/Orders'));
const AdminCoupons = lazy(() => import('./pages/admin/Coupons'));
const AdminUsers = lazy(() => import('./pages/admin/Users'));

export default function App() {
  const { pathname } = useLocation();
  return (
    <ErrorBoundary resetKey={pathname}>
      <ScrollToTop />
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route element={<SiteLayout />}>
            <Route index element={<Home />} />
            <Route path="shop" element={<Shop />} />
            <Route path="books/:slug" element={<ProductDetail />} />
            <Route path="cart" element={<Cart />} />
            <Route path="wishlist" element={<Wishlist />} />
            <Route path="about" element={<About />} />
            <Route path="login" element={<GuestOnly><Login /></GuestOnly>} />
            <Route path="register" element={<GuestOnly><Register /></GuestOnly>} />
            <Route path="forgot-password" element={<ForgotPassword />} />
            <Route path="reset-password" element={<ResetPassword />} />
            <Route element={<RequireAuth />}>
              <Route path="checkout" element={<Checkout />} />
              <Route path="orders" element={<Orders />} />
              <Route path="orders/:id" element={<OrderDetail />} />
              <Route path="account" element={<Account />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Route>
          <Route path="admin" element={<RequireAdmin><AdminLayout /></RequireAdmin>}>
            <Route index element={<AdminDashboard />} />
            <Route path="products" element={<AdminProducts />} />
            <Route path="inventory" element={<AdminInventory />} />
            <Route path="orders" element={<AdminOrders />} />
            <Route path="coupons" element={<AdminCoupons />} />
            <Route path="users" element={<AdminUsers />} />
          </Route>
        </Routes>
      </Suspense>
    </ErrorBoundary>
  );
}
