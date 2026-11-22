import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ArrowLeft,
  Bell,
  Check,
  CheckCircle2,
  ClipboardCheck,
  Copy,
  Heart,
  Home,
  Images,
  Lock,
  Minus,
  Moon,
  PackageSearch,
  Plus,
  Search,
  ShoppingBag,
  ShoppingCart,
  Sparkles,
  Star,
  Sun,
  Trash2,
  UtensilsCrossed,
} from 'lucide-react';
import {
  createOrder,
  fetchPublicProducts,
  fetchStoreConfig,
  lookupCustomerOrder,
  validateCartStock,
} from '../lib/api';
import {
  ORDER_STATUS_META,
  type CartItem,
  type OrderRecord,
  type OrderStatus,
  type Product,
  type StoreConfig,
} from '../types';
import { SafeImage } from './SafeImage';
import { ProductGalleryModal } from './ProductGalleryModal';

const HERO_IMAGE_URL = '/src/assets/images/hero_bibis_bakery_1795268388567.jpg';

type StorePage = 'home' | 'cart' | 'checkout' | 'success' | 'track';

interface StorefrontViewProps {
  onOpenAdmin: () => void;
  isDark: boolean;
  onToggleTheme: () => void;
}

const PROGRESS_STEPS: OrderStatus[] = [
  'pending',
  'confirmed',
  'preparing',
  'delivering',
  'completed',
];

export const StorefrontView: React.FC<StorefrontViewProps> = ({
  onOpenAdmin,
  isDark,
  onToggleTheme,
}) => {
  const [page, setPage] = useState<StorePage>('home');
  const [products, setProducts] = useState<Product[]>([]);
  const [storeConfig, setStoreConfig] = useState<StoreConfig>({
    shipping_mode: 'fixed',
    shipping_fee: 40,
    free_shipping_threshold: 500,
  });
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Filters & card quantity selectors
  const [activeCategory, setActiveCategory] = useState<string>('ทั้งหมด');
  const [searchQuery, setSearchQuery] = useState('');
  const [cardQtys, setCardQtys] = useState<Record<number, number>>({});
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);

  // Shopping cart
  const [cart, setCart] = useState<CartItem[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [cartValidationError, setCartValidationError] = useState<string | null>(null);
  const [validatingCart, setValidatingCart] = useState(false);

  // Checkout state
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerInstagram, setCustomerInstagram] = useState('');
  const [customerAddress, setCustomerAddress] = useState('');
  const [orderNote, setOrderNote] = useState('');
  const [confirmChecked, setConfirmChecked] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [submittingOrder, setSubmittingOrder] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState<string>(() => crypto.randomUUID());

  // Order success
  const [completedOrder, setCompletedOrder] = useState<OrderRecord | null>(null);
  const [copiedOrderNo, setCopiedOrderNo] = useState(false);

  // Order tracking
  const [trackOrderNumber, setTrackOrderNumber] = useState('');
  const [trackPhone, setTrackPhone] = useState('');
  const [trackedOrder, setTrackedOrder] = useState<OrderRecord | null>(null);
  const [trackError, setTrackError] = useState<string | null>(null);
  const [trackingLoading, setTrackingLoading] = useState(false);

  const menuSectionRef = useRef<HTMLElement | null>(null);

  const loadStoreData = async () => {
    try {
      setLoading(true);
      const [prods, cfg] = await Promise.all([fetchPublicProducts(), fetchStoreConfig()]);
      setProducts(prods);
      setStoreConfig(cfg);
      setErrorMsg(null);
    } catch (err: any) {
      setErrorMsg(err?.message || 'ไม่สามารถโหลดเมนูขนมได้');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStoreData();
  }, []);

  const showToast = (msg: string, durationMs = 2600) => {
    setToast(msg);
    window.setTimeout(() => {
      setToast((prev) => (prev === msg ? null : prev));
    }, durationMs);
  };

  const productMap = useMemo(() => {
    const map = new Map<number, Product>();
    products.forEach((p) => map.set(p.id, p));
    return map;
  }, [products]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    products.forEach((p) => {
      if (p.category) set.add(p.category);
    });
    return ['ทั้งหมด', ...Array.from(set)];
  }, [products]);

  const filteredProducts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return products.filter((p) => {
      const catMatch = activeCategory === 'ทั้งหมด' || p.category === activeCategory;
      const textMatch =
        !q ||
        p.name.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q);
      return catMatch && textMatch;
    });
  }, [products, activeCategory, searchQuery]);

  const cartDetails = useMemo(() => {
    return cart
      .map((item) => {
        const product = productMap.get(item.productId);
        if (!product) return null;
        return {
          product,
          quantity: item.quantity,
          lineTotal: product.price * item.quantity,
        };
      })
      .filter(Boolean) as Array<{ product: Product; quantity: number; lineTotal: number }>;
  }, [cart, productMap]);

  const totalCartItems = useMemo(
    () => cartDetails.reduce((acc, item) => acc + item.quantity, 0),
    [cartDetails]
  );

  const cartSubtotal = useMemo(
    () => cartDetails.reduce((acc, item) => acc + item.lineTotal, 0),
    [cartDetails]
  );

  const computedShippingFee = useMemo(() => {
    if (cartDetails.length === 0) return 0;
    if (storeConfig.shipping_mode === 'pending') return null;
    if (
      storeConfig.free_shipping_threshold > 0 &&
      cartSubtotal >= storeConfig.free_shipping_threshold
    ) {
      return 0;
    }
    return storeConfig.shipping_fee;
  }, [cartDetails.length, storeConfig, cartSubtotal]);

  const grandTotal = useMemo(() => {
    if (computedShippingFee === null) return cartSubtotal;
    return cartSubtotal + computedShippingFee;
  }, [cartSubtotal, computedShippingFee]);

  const getCartQty = (productId: number) =>
    cart.find((c) => c.productId === productId)?.quantity || 0;

  const handleAddToCart = (product: Product, addQty: number) => {
    if (product.stock <= 0 || product.status !== 'active') return;
    const current = getCartQty(product.id);
    const nextQty = Math.min(product.stock, current + addQty);
    if (nextQty <= current) {
      showToast(`เมนู ${product.name} ครบจำนวนคงเหลือแล้ว`);
      return;
    }
    setCart((prev) => {
      const exists = prev.some((c) => c.productId === product.id);
      if (exists) {
        return prev.map((c) => (c.productId === product.id ? { ...c, quantity: nextQty } : c));
      }
      return [...prev, { productId: product.id, quantity: nextQty }];
    });
    setCardQtys((prev) => ({ ...prev, [product.id]: 1 }));
    setCartValidationError(null);
    showToast(`เพิ่ม ${product.name} (${nextQty - current} ชิ้น) ลงตะกร้าแล้ว ♡`);
  };

  const handleUpdateCartQty = (productId: number, delta: number) => {
    const product = productMap.get(productId);
    if (!product) return;
    setCartValidationError(null);
    setCart((prev) =>
      prev
        .map((c) => {
          if (c.productId !== productId) return c;
          const next = Math.min(product.stock, c.quantity + delta);
          return next <= 0 ? null : { ...c, quantity: next };
        })
        .filter(Boolean) as CartItem[]
    );
  };

  const handleRemoveCartItem = (productId: number) => {
    setCartValidationError(null);
    setCart((prev) => prev.filter((c) => c.productId !== productId));
  };

  const handleProceedToCheckout = async () => {
    if (cartDetails.length === 0) return;
    setValidatingCart(true);
    setCartValidationError(null);
    try {
      await validateCartStock(
        cartDetails.map((d) => ({ productId: d.product.id, quantity: d.quantity }))
      );
      setIdempotencyKey(crypto.randomUUID());
      setCheckoutError(null);
      setPage('checkout');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err: any) {
      setCartValidationError(
        err?.message || 'จำนวนสินค้าคงเหลือมีการเปลี่ยนแปลง กรุณาตรวจสอบตะกร้าอีกครั้ง'
      );
      await loadStoreData();
    } finally {
      setValidatingCart(false);
    }
  };

  const handleSubmitOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submittingOrder) return;

    const cleanName = customerName.trim();
    const cleanPhone = customerPhone.trim();
    const cleanIg = customerInstagram.trim();
    const cleanAddr = customerAddress.trim();

    if (!cleanName || cleanName.length < 2) {
      setCheckoutError('กรุณากรอกชื่อ–นามสกุล');
      return;
    }
    if (cleanPhone.replace(/[^0-9]/g, '').length < 9) {
      setCheckoutError('กรุณากรอกเบอร์โทรศัพท์ที่ถูกต้อง (อย่างน้อย 9 หลัก)');
      return;
    }
    if (!cleanIg) {
      setCheckoutError('กรุณากรอกชื่อ Instagram สำหรับติดต่อยืนยันออเดอร์');
      return;
    }
    if (!cleanAddr || cleanAddr.length < 8) {
      setCheckoutError('กรุณากรอกที่อยู่จัดส่งให้ครบถ้วน');
      return;
    }
    if (!confirmChecked) {
      setCheckoutError('กรุณาติ๊กยืนยันว่าตรวจสอบข้อมูลและรายการสั่งซื้อเรียบร้อยแล้ว');
      return;
    }

    setSubmittingOrder(true);
    setCheckoutError(null);

    try {
      const res = await createOrder({
        customer: {
          name: cleanName,
          phone: cleanPhone,
          instagram: cleanIg,
          address: cleanAddr,
        },
        items: cartDetails.map((d) => ({
          productId: d.product.id,
          quantity: d.quantity,
        })),
        note: orderNote.trim(),
        idempotencyKey,
      });

      setCompletedOrder(res.order);
      setCopiedOrderNo(false);
      setCart([]);
      setConfirmChecked(false);
      setOrderNote('');
      setTrackOrderNumber(res.order.order_number);
      setTrackPhone(cleanPhone);
      await loadStoreData();
      setPage('success');
      showToast(
        `สั่งซื้อสำเร็จแล้ว! เลขออเดอร์ ${res.order.order_number} ทางร้านได้รับออเดอร์ของคุณแล้ว 🩵`,
        4800
      );
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err: any) {
      setCheckoutError(err?.message || 'ไม่สามารถยืนยันออเดอร์ได้ กรุณาลองใหม่อีกครั้ง');
      await loadStoreData();
    } finally {
      setSubmittingOrder(false);
    }
  };

  const handleTrackOrder = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setTrackError(null);
    setTrackedOrder(null);
    if (!trackOrderNumber.trim() || !trackPhone.trim()) {
      setTrackError('กรุณากรอกเลขที่ออเดอร์และเบอร์โทรศัพท์ที่ใช้สั่งซื้อ');
      return;
    }
    setTrackingLoading(true);
    try {
      const { order } = await lookupCustomerOrder(trackOrderNumber.trim(), trackPhone.trim());
      setTrackedOrder(order);
    } catch (err: any) {
      setTrackError(err?.message || 'ไม่พบข้อมูลออเดอร์ กรุณาตรวจสอบอีกครั้ง');
    } finally {
      setTrackingLoading(false);
    }
  };

  const goToMenu = () => {
    if (page !== 'home') {
      setPage('home');
      window.setTimeout(() => {
        menuSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 120);
    } else {
      menuSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#F8FBFF] text-[#1C3554] pb-20 md:pb-0">
      {/* Top Bar Contract: 3 zones separated by gap-8 on desktop, compact on mobile */}
      <header className="sticky top-0 z-30 bg-white/92 backdrop-blur-md border-b border-[#E1EFFB]">
        <div className="max-w-6xl mx-auto px-3.5 sm:px-6 h-14 md:h-16 flex items-center justify-between gap-3 md:gap-8">
          {/* Zone 1: Brand wordmark + optional store logo (single element, whitespace-nowrap) */}
          <button
            type="button"
            onClick={() => {
              setPage('home');
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
            className="inline-flex items-center gap-2 font-display text-lg sm:text-xl font-bold tracking-tight text-[#1C3554] hover:text-[#2F7CC0] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            {storeConfig.store_logo_url && (
              <SafeImage
                src={storeConfig.store_logo_url}
                alt="โลโก้ร้าน Bibi's Treats"
                className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl object-cover border border-[#DCECFB] bg-[#F4F9FF] shrink-0"
              />
            )}
            <span>Bibi&apos;s Treats 🩵</span>
          </button>

          {/* Zone 2: 4 clean single-line navigation links */}
          <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-[#4A688A]">
            <button
              type="button"
              onClick={() => {
                setPage('home');
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              className={`hover:text-[#2F7CC0] transition-colors whitespace-nowrap shrink-0 cursor-pointer pb-0.5 ${
                page === 'home' ? 'text-[#2F7CC0] border-b-2 border-[#5CA9E6]' : ''
              }`}
            >
              หน้าแรก
            </button>
            <button
              type="button"
              onClick={goToMenu}
              className="hover:text-[#2F7CC0] transition-colors whitespace-nowrap shrink-0 cursor-pointer pb-0.5"
            >
              เมนูขนม
            </button>
            <button
              type="button"
              onClick={() => {
                setPage('track');
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              className={`hover:text-[#2F7CC0] transition-colors whitespace-nowrap shrink-0 cursor-pointer pb-0.5 ${
                page === 'track' ? 'text-[#2F7CC0] border-b-2 border-[#5CA9E6]' : ''
              }`}
            >
              ตรวจสอบออเดอร์
            </button>
            <button
              type="button"
              onClick={onOpenAdmin}
              className="hover:text-[#2F7CC0] transition-colors whitespace-nowrap shrink-0 cursor-pointer pb-0.5"
            >
              หลังบ้าน
            </button>
          </nav>

          {/* Zone 3: Theme Toggle + 1 primary CTA (Shopping Cart) */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onToggleTheme}
              aria-label={isDark ? 'เปลี่ยนเป็นโหมดสว่าง' : 'เปลี่ยนเป็นโหมดมืด'}
              title={isDark ? 'โหมดสว่าง' : 'โหมดมืด'}
              className="w-9 h-9 sm:w-10 sm:h-10 rounded-2xl bg-[#EFF7FF] hover:bg-[#DFEEFE] text-[#2F7CC0] flex items-center justify-center transition-colors shrink-0 cursor-pointer"
            >
              {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            <button
              type="button"
              onClick={() => {
                setPage('cart');
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              className="px-3 sm:px-4 py-2 rounded-2xl bg-[#3B89CC] hover:bg-[#2E76B6] text-white text-xs sm:text-sm font-medium flex items-center gap-1.5 sm:gap-2 transition-colors shadow-sm whitespace-nowrap shrink-0 cursor-pointer"
            >
              <ShoppingCart className="w-4 h-4 shrink-0" />
              <span>
                ตะกร้า<span className="hidden sm:inline">สินค้า</span>
              </span>
              {totalCartItems > 0 && (
                <span className="ml-0.5 min-w-[20px] h-5 px-1.5 rounded-full bg-white text-[#2F7CC0] text-xs font-bold flex items-center justify-center tabular-nums">
                  {totalCartItems}
                </span>
              )}
            </button>
          </div>
        </div>
      </header>

      {/* Toast Feedback */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: -16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -16 }}
            transition={{ duration: 0.18 }}
            className="fixed top-16 sm:top-20 left-3.5 right-3.5 sm:left-auto sm:right-6 sm:max-w-md z-40 rounded-2xl bg-[#1C3554] text-white px-4 py-3 text-xs sm:text-sm font-medium shadow-xl flex items-center justify-between gap-3"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <Heart className="w-4 h-4 text-[#8ECAF8] fill-[#8ECAF8] shrink-0" />
              <span className="leading-snug">{toast}</span>
            </div>
            {page !== 'cart' && (
              <button
                type="button"
                onClick={() => setPage('cart')}
                className="text-xs underline text-[#A8DBFF] hover:text-white whitespace-nowrap shrink-0"
              >
                ดูตะกร้า
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Content */}
      <main className="flex-1">
        {/* ================= PAGE 1: HOME & MENU ================= */}
        {page === 'home' && (
          <div>
            {/* Hero Banner */}
            <section className="bg-gradient-to-b from-[#EAF5FF] via-[#F4FAFF] to-[#F8FBFF] border-b border-[#E3F0FC]">
              <div className="max-w-6xl mx-auto px-4 sm:px-6 py-7 sm:py-12 md:py-16">
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 sm:gap-8 lg:gap-10 items-stretch">
                  {/* Left Hero Copy */}
                  <div className="lg:col-span-6 flex flex-col justify-center">
                    <p className="text-xs sm:text-sm font-medium text-[#3B89CC] tracking-wide">
                      Bibi&apos;s Treats · Sweet treats, happy hearts ♡
                    </p>
                    <h1 className="mt-2 sm:mt-3 text-[24px] sm:text-4xl lg:text-[42px] font-bold leading-[1.3] sm:leading-[1.22] text-[#1C3554]">
                      ขนมอร่อย ๆ พร้อมเสิร์ฟความสุขให้คุณ 🧁
                    </h1>
                    <p className="mt-3 sm:mt-4 text-sm sm:text-base leading-relaxed text-[#4C6A8B] max-w-xl">
                      อบสดใหม่จากเตาทุกเช้าด้วยวัตถุดิบพรีเมียม หวานกำลังดี หอมละมุน
                      เลือกเมนูโปรดลงตะกร้าและยืนยันออเดอร์ได้ด้วยตัวเองในไม่กี่ขั้นตอน
                    </p>

                    <div className="mt-5 sm:mt-7 grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-2.5 sm:gap-3">
                      <button
                        type="button"
                        onClick={goToMenu}
                        className="px-3.5 sm:px-6 py-3 sm:py-3.5 rounded-2xl bg-[#3B89CC] hover:bg-[#2E76B6] text-white text-xs sm:text-base font-semibold shadow-md shadow-[#3B89CC]/20 transition-all hover:-translate-y-0.5 whitespace-nowrap shrink-0 cursor-pointer text-center"
                      >
                        เลือกเมนูของเรา ✨
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setPage('track');
                          window.scrollTo({ top: 0, behavior: 'smooth' });
                        }}
                        className="px-3.5 sm:px-5 py-3 sm:py-3.5 rounded-2xl bg-white hover:bg-[#EDF6FF] text-[#2F7CC0] border border-[#CFE6FA] text-xs sm:text-base font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer text-center"
                      >
                        ตรวจสอบออเดอร์
                      </button>
                    </div>

                    <div className="mt-5 sm:mt-7 pt-4 sm:pt-5 border-t border-[#D8EBFA] flex flex-wrap items-center gap-x-3 sm:gap-x-5 gap-y-1.5 text-xs sm:text-sm text-[#567394] leading-relaxed">
                      <span>อบสดใหม่จำนวนจำกัดต่อรอบ</span>
                      <span aria-hidden="true" className="hidden sm:inline">·</span>
                      <span>
                        {storeConfig.shipping_mode === 'pending'
                          ? 'ค่าจัดส่งยืนยันตามระยะทาง'
                          : storeConfig.free_shipping_threshold > 0
                          ? `ส่งฟรีเมื่อครบ ${storeConfig.free_shipping_threshold.toLocaleString()} ฿`
                          : `ค่าจัดส่งเหมาจ่าย ${storeConfig.shipping_fee} บาท`}
                      </span>
                      <span aria-hidden="true" className="hidden sm:inline">·</span>
                      <span>ติดตามออเดอร์ได้ตลอดเวลา</span>
                    </div>
                  </div>

                  {/* Right Hero Image */}
                  <div className="lg:col-span-6">
                    <div className="relative h-full min-h-[210px] sm:min-h-[340px] rounded-3xl sm:rounded-[28px] overflow-hidden border border-[#D7EBFC] shadow-xl shadow-[#3B89CC]/10 bg-white">
                      <SafeImage
                        src={HERO_IMAGE_URL}
                        alt="ขนมโฮมเมดร้าน Bibi's Treats บราวนี่ คัพเค้ก ชอร์ตเค้ก และคุกกี้เนยสด"
                        className="w-full h-full object-cover"
                        fallbackLabel="Bibi's Treats Bakery"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {/* Our Menu Section */}
            <section
              id="our-menu"
              ref={menuSectionRef}
              className="max-w-6xl mx-auto px-4 sm:px-6 py-12 md:py-16"
            >
              <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                <div>
                  <p className="text-xs font-medium text-[#567394]">
                    Freshly Baked Daily · เลือกเมนูและจำนวนที่ต้องการได้เลยค่ะ
                  </p>
                  <h2 className="mt-1 text-2xl sm:text-3xl font-bold text-[#1C3554]">
                    🧁 Our Menu
                  </h2>
                </div>

                {/* Search Box */}
                <div className="relative w-full md:w-72">
                  <Search className="w-4 h-4 text-[#6B89A8] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="ค้นหาเมนูขนม..."
                    className="w-full pl-10 pr-4 py-2.5 rounded-2xl bg-white border border-[#D8EAFB] text-sm text-[#1C3554] placeholder:text-[#86A1BE] focus:outline-none focus:border-[#5CA9E6] focus:ring-2 focus:ring-[#D9EEFF]"
                  />
                </div>
              </div>

              {/* Interactive Category Filter Tabs */}
              <div className="mt-6 flex items-center gap-2 overflow-x-auto pb-1">
                {categories.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setActiveCategory(cat)}
                    className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      activeCategory === cat
                        ? 'bg-[#3B89CC] text-white shadow-sm'
                        : 'bg-white text-[#4B6889] border border-[#DFEEFB] hover:bg-[#EDF6FF]'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>

              {/* Loading / Error / Product Grid */}
              {loading ? (
                <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                  {[1, 2, 3, 4, 5, 6].map((n) => (
                    <div
                      key={n}
                      className="rounded-3xl bg-white border border-[#E1EFFB] overflow-hidden animate-pulse"
                    >
                      <div className="aspect-[4/3] bg-[#EAF4FD]" />
                      <div className="p-5 space-y-3">
                        <div className="h-5 bg-[#EAF4FD] rounded-lg w-2/3" />
                        <div className="h-4 bg-[#F1F7FD] rounded-lg w-full" />
                        <div className="h-10 bg-[#EAF4FD] rounded-xl w-full mt-4" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : errorMsg ? (
                <div className="mt-8 rounded-3xl bg-white border border-[#FAD4DC] p-8 text-center">
                  <p className="text-sm text-[#B4233C]">{errorMsg}</p>
                  <button
                    type="button"
                    onClick={loadStoreData}
                    className="mt-4 px-5 py-2.5 rounded-xl bg-[#3B89CC] text-white text-sm font-medium"
                  >
                    ลองโหลดใหม่อีกครั้ง
                  </button>
                </div>
              ) : filteredProducts.length === 0 ? (
                <div className="mt-8 rounded-3xl bg-white border border-[#E1EFFB] p-12 text-center">
                  <p className="text-base font-medium text-[#1C3554]">ไม่พบเมนูขนมที่ค้นหา</p>
                  <p className="mt-1 text-sm text-[#567394]">ลองเปลี่ยนคำค้นหาหรือเลือกดูหมวดหมู่อื่นนะคะ</p>
                </div>
              ) : (
                <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                  {filteredProducts.map((product) => {
                    const isSoldOut = product.stock <= 0;
                    const inCart = getCartQty(product.id);
                    const remainingCanAdd = Math.max(0, product.stock - inCart);
                    const selectedQty = Math.min(
                      Math.max(1, cardQtys[product.id] || 1),
                      Math.max(1, remainingCanAdd)
                    );

                    return (
                      <article
                        key={product.id}
                        className="bakery-card bakery-card-hover rounded-3xl overflow-hidden flex flex-col"
                      >
                        {/* Product Photo (clickable to view gallery slider) */}
                        <div
                          onClick={() => setSelectedProduct(product)}
                          className="relative aspect-[4/3] w-full bg-[#F2F8FF] overflow-hidden cursor-pointer group"
                        >
                          <SafeImage
                            src={product.primary_image}
                            alt={product.name}
                            className={`w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.03] ${
                              isSoldOut ? 'grayscale-[35%] opacity-85' : ''
                            }`}
                            fallbackLabel={product.name}
                          />

                          {isSoldOut && (
                            <div className="absolute inset-0 bg-[#1C3554]/35 flex items-center justify-center">
                              <span className="px-4 py-1.5 rounded-2xl bg-white/95 text-[#B4233C] text-sm font-bold tracking-wide shadow-md">
                                SOLD OUT ♡
                              </span>
                            </div>
                          )}

                          {product.images.length > 1 && (
                            <div className="absolute bottom-3 right-3 px-2.5 py-1 rounded-xl bg-[#1C3554]/70 text-white text-xs font-medium flex items-center gap-1.5">
                              <Images className="w-3.5 h-3.5" />
                              <span className="tabular-nums">{product.images.length} รูป</span>
                            </div>
                          )}
                        </div>

                        {/* Product Info */}
                        <div className="p-4 sm:p-5 flex-1 flex flex-col justify-between">
                          <div>
                            <div className="flex items-center justify-between gap-2 text-xs text-[#567394]">
                              <span className="truncate">{product.category}</span>
                              {!isSoldOut ? (
                                <span
                                  className={`tabular-nums font-medium shrink-0 ${
                                    product.stock_state === 'low'
                                      ? 'text-[#B45309]'
                                      : 'text-[#3B89CC]'
                                  }`}
                                >
                                  เหลือ {product.stock} ชิ้น
                                </span>
                              ) : (
                                <span className="font-semibold text-[#C42746] shrink-0">SOLD OUT ♡</span>
                              )}
                            </div>

                            <h3
                              onClick={() => setSelectedProduct(product)}
                              className="mt-1.5 text-base sm:text-lg font-semibold text-[#1C3554] leading-snug hover:text-[#2F7CC0] cursor-pointer transition-colors"
                            >
                              {product.name}
                            </h3>

                            <p className="mt-1.5 text-xs sm:text-sm leading-relaxed text-[#547190] line-clamp-2">
                              {product.description}
                            </p>
                          </div>

                          <div className="mt-4 sm:mt-5 pt-3.5 sm:pt-4 border-t border-[#EDF5FD]">
                            <div className="flex items-baseline justify-between gap-2 mb-3">
                              <span className="text-lg sm:text-xl font-bold text-[#2F7CC0] tabular-nums">
                                ราคา {product.price.toLocaleString()} บาท
                              </span>
                              {inCart > 0 && (
                                <span className="text-xs font-medium text-[#3B89CC] tabular-nums shrink-0">
                                  ในตะกร้า {inCart} ชิ้น
                                </span>
                              )}
                            </div>

                            {isSoldOut ? (
                              <button
                                type="button"
                                disabled
                                className="w-full h-11 rounded-2xl bg-[#EEF3F8] text-[#839AB2] text-sm font-semibold cursor-not-allowed"
                              >
                                SOLD OUT ♡
                              </button>
                            ) : (
                              <div className="flex items-center gap-2">
                                <div className="flex items-center border border-[#D4E8FA] rounded-2xl bg-[#F8FBFF] shrink-0">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setCardQtys((prev) => ({
                                        ...prev,
                                        [product.id]: Math.max(1, (prev[product.id] || 1) - 1),
                                      }))
                                    }
                                    disabled={selectedQty <= 1 || remainingCanAdd <= 0}
                                    className="w-9 sm:w-10 h-11 flex items-center justify-center text-[#1C3554] hover:bg-[#E6F3FF] rounded-l-2xl disabled:opacity-35 cursor-pointer"
                                    aria-label={`ลดจำนวน ${product.name}`}
                                  >
                                    <Minus className="w-4 h-4" />
                                  </button>
                                  <span className="w-7 sm:w-8 text-center text-sm font-semibold tabular-nums">
                                    {remainingCanAdd <= 0 ? 0 : selectedQty}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setCardQtys((prev) => ({
                                        ...prev,
                                        [product.id]: Math.min(
                                          remainingCanAdd,
                                          (prev[product.id] || 1) + 1
                                        ),
                                      }))
                                    }
                                    disabled={selectedQty >= remainingCanAdd || remainingCanAdd <= 0}
                                    className="w-9 sm:w-10 h-11 flex items-center justify-center text-[#1C3554] hover:bg-[#E6F3FF] rounded-r-2xl disabled:opacity-35 cursor-pointer"
                                    aria-label={`เพิ่มจำนวน ${product.name}`}
                                  >
                                    <Plus className="w-4 h-4" />
                                  </button>
                                </div>

                                <button
                                  type="button"
                                  disabled={remainingCanAdd <= 0}
                                  onClick={() => handleAddToCart(product, selectedQty)}
                                  className="flex-1 min-w-0 h-11 px-3 sm:px-4 rounded-2xl bg-[#3B89CC] hover:bg-[#2E76B6] text-white text-xs sm:text-sm font-semibold flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50 whitespace-nowrap cursor-pointer"
                                >
                                  <span className="truncate">
                                    {remainingCanAdd <= 0 ? 'ครบจำนวนแล้ว' : 'เพิ่มลงตะกร้า 🛒'}
                                  </span>
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        )}

        {/* ================= PAGE 2: SHOPPING CART ================= */}
        {page === 'cart' && (
          <section className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-4 mb-5 sm:mb-6">
              <div>
                <p className="text-xs font-medium text-[#567394]">Bibi&apos;s Treats · ตะกร้าขนมของคุณ</p>
                <h1 className="mt-1 text-xl sm:text-3xl font-bold text-[#1C3554]">
                  My Shopping Cart 🩵
                </h1>
              </div>
              <button
                type="button"
                onClick={() => setPage('home')}
                className="self-start sm:self-auto text-xs sm:text-sm font-medium text-[#3B89CC] hover:text-[#24639C] flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
              >
                <ArrowLeft className="w-4 h-4" />
                กลับไปเลือกสินค้า
              </button>
            </div>

            {cartValidationError && (
              <div className="mb-5 rounded-2xl bg-[#FFF0F3] border border-[#F7C5D0] px-4 py-3 text-xs sm:text-sm text-[#B4233C]">
                {cartValidationError}
              </div>
            )}

            {cartDetails.length === 0 ? (
              <div className="bakery-card rounded-3xl p-8 sm:p-12 text-center">
                <div className="w-16 h-16 rounded-3xl bg-[#EAF5FF] text-[#3B89CC] flex items-center justify-center mx-auto">
                  <ShoppingBag className="w-8 h-8" />
                </div>
                <h2 className="mt-4 text-base sm:text-lg font-semibold text-[#1C3554]">
                  ยังไม่มีขนมในตะกร้าเลยค่ะ ♡
                </h2>
                <p className="mt-1 text-xs sm:text-sm text-[#567394]">
                  ลองแวะชมเมนูขนมอบสดใหม่ของเราแล้วเลือกชิ้นที่ถูกใจได้เลยนะคะ
                </p>
                <button
                  type="button"
                  onClick={() => setPage('home')}
                  className="mt-6 px-6 py-3 rounded-2xl bg-[#3B89CC] hover:bg-[#2E76B6] text-white text-sm font-semibold transition-colors cursor-pointer"
                >
                  กลับไปเลือกสินค้า ✨
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 sm:gap-6 items-start">
                {/* Itemized List */}
                <div className="lg:col-span-7 space-y-3.5 sm:space-y-4">
                  {cartDetails.map(({ product, quantity, lineTotal }) => (
                    <div
                      key={product.id}
                      className="bakery-card rounded-3xl p-3.5 sm:p-5 flex gap-3 sm:gap-4 items-start sm:items-center"
                    >
                      <div className="w-16 h-16 sm:w-24 sm:h-24 rounded-2xl overflow-hidden bg-[#F1F8FF] shrink-0">
                        <SafeImage
                          src={product.primary_image}
                          alt={product.name}
                          className="w-full h-full object-cover"
                        />
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <h3 className="text-sm sm:text-base font-semibold text-[#1C3554] leading-snug line-clamp-2">
                              {product.name}
                            </h3>
                            <p className="text-[11px] sm:text-xs text-[#567394] mt-0.5 tabular-nums leading-snug">
                              {product.price.toLocaleString()} บาท/ชิ้น · เหลือ {product.stock} ชิ้น
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleRemoveCartItem(product.id)}
                            className="p-2 -mr-1 rounded-xl text-[#839BB2] hover:bg-[#FFF0F3] hover:text-[#C42746] transition-colors shrink-0 cursor-pointer"
                            aria-label={`ลบ ${product.name}`}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>

                        <div className="mt-2.5 sm:mt-3 flex items-center justify-between gap-2">
                          <div className="flex items-center border border-[#D4E8FA] rounded-xl bg-[#F8FBFF]">
                            <button
                              type="button"
                              onClick={() => handleUpdateCartQty(product.id, -1)}
                              className="w-9 h-9 flex items-center justify-center text-[#1C3554] hover:bg-[#E6F3FF] rounded-l-xl cursor-pointer"
                              aria-label="ลดจำนวน"
                            >
                              <Minus className="w-3.5 h-3.5" />
                            </button>
                            <span className="w-8 sm:w-9 text-center text-sm font-semibold tabular-nums">
                              {quantity}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleUpdateCartQty(product.id, 1)}
                              disabled={quantity >= product.stock}
                              className="w-9 h-9 flex items-center justify-center text-[#1C3554] hover:bg-[#E6F3FF] rounded-r-xl disabled:opacity-40 cursor-pointer"
                              aria-label="เพิ่มจำนวน"
                            >
                              <Plus className="w-3.5 h-3.5" />
                            </button>
                          </div>

                          <p className="text-sm sm:text-base font-bold text-[#2F7CC0] tabular-nums shrink-0">
                            {lineTotal.toLocaleString()} บาท
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Order Summary Card */}
                <div className="lg:col-span-5 bakery-card rounded-3xl p-6">
                  <h2 className="text-lg font-semibold text-[#1C3554]">สรุปออเดอร์</h2>

                  <div className="mt-4 space-y-3 text-sm">
                    <div className="flex items-center justify-between text-[#4A688A]">
                      <span>จำนวนสินค้าทั้งหมด</span>
                      <span className="font-semibold text-[#1C3554] tabular-nums">
                        {totalCartItems} ชิ้น
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[#4A688A]">
                      <span>ยอดรวมสินค้า</span>
                      <span className="font-semibold text-[#1C3554] tabular-nums">
                        {cartSubtotal.toLocaleString()} บาท
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[#4A688A]">
                      <span>ค่าจัดส่ง</span>
                      <span className="font-semibold text-[#1C3554] tabular-nums">
                        {computedShippingFee === null
                          ? 'รอยืนยัน'
                          : computedShippingFee === 0
                          ? 'ฟรีค่าจัดส่ง ♡'
                          : `${computedShippingFee.toLocaleString()} บาท`}
                      </span>
                    </div>

                    {storeConfig.shipping_mode === 'fixed' &&
                      storeConfig.free_shipping_threshold > 0 &&
                      cartSubtotal < storeConfig.free_shipping_threshold && (
                        <p className="text-xs text-[#3B89CC] bg-[#EDF6FF] rounded-xl px-3 py-2">
                          สั่งเพิ่มอีก{' '}
                          {(storeConfig.free_shipping_threshold - cartSubtotal).toLocaleString()}{' '}
                          บาท รับสิทธิ์ส่งฟรีทันที!
                        </p>
                      )}

                    <div className="pt-3 border-t border-[#E6F2FC] flex items-baseline justify-between">
                      <span className="text-base font-semibold text-[#1C3554]">ยอดรวมสุทธิ</span>
                      <span className="text-2xl font-bold text-[#2F7CC0] tabular-nums">
                        {grandTotal.toLocaleString()} บาท
                        {computedShippingFee === null && (
                          <span className="block text-xs font-normal text-[#567394] text-right">
                            (ยังไม่รวมค่าจัดส่ง)
                          </span>
                        )}
                      </span>
                    </div>
                  </div>

                  <div className="mt-6 space-y-2.5">
                    <button
                      type="button"
                      disabled={validatingCart}
                      onClick={handleProceedToCheckout}
                      className="w-full h-12 rounded-2xl bg-[#3B89CC] hover:bg-[#2E76B6] text-white text-sm font-semibold transition-colors disabled:opacity-60 cursor-pointer"
                    >
                      {validatingCart ? 'กำลังตรวจสอบจำนวนสินค้า...' : 'ดำเนินการต่อ 💙'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setPage('home')}
                      className="w-full h-11 rounded-2xl bg-[#EFF7FF] hover:bg-[#E1F0FE] text-[#2F7CC0] text-sm font-medium transition-colors cursor-pointer"
                    >
                      กลับไปเลือกสินค้า
                    </button>
                  </div>
                </div>
              </div>
            )}
          </section>
        )}

        {/* ================= PAGE 3: CHECKOUT ================= */}
        {page === 'checkout' && (
          <section className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-4 mb-5 sm:mb-6">
              <div>
                <p className="text-xs font-medium text-[#567394]">ขั้นตอนสุดท้ายก่อนอบความสุขส่งถึงบ้าน</p>
                <h1 className="mt-1 text-xl sm:text-3xl font-bold text-[#1C3554]">
                  Confirm Your Order ♡
                </h1>
              </div>
              <button
                type="button"
                onClick={() => setPage('cart')}
                className="self-start sm:self-auto text-xs sm:text-sm font-medium text-[#3B89CC] hover:text-[#24639C] flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
              >
                <ArrowLeft className="w-4 h-4" />
                แก้ไขตะกร้า
              </button>
            </div>

            <form
              onSubmit={handleSubmitOrder}
              className="grid grid-cols-1 lg:grid-cols-12 gap-5 sm:gap-6 items-start"
            >
              {/* Customer Details Form */}
              <div className="lg:col-span-7 bakery-card rounded-3xl p-4 sm:p-6 space-y-4 sm:space-y-5">
                <h2 className="text-base sm:text-lg font-semibold text-[#1C3554]">ข้อมูลผู้สั่งซื้อและที่อยู่จัดส่ง</h2>

                {checkoutError && (
                  <div className="rounded-2xl bg-[#FFF0F3] border border-[#F7C5D0] px-4 py-3 text-xs sm:text-sm text-[#B4233C]">
                    {checkoutError}
                  </div>
                )}

                <div className="space-y-4">
                  <div>
                    <label className="block text-xs sm:text-sm font-medium text-[#2A496B] mb-1.5">
                      ชื่อ–นามสกุล <span className="text-[#D63653]">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={customerName}
                      onChange={(e) => setCustomerName(e.target.value)}
                      placeholder="เช่น นภัสสร ใจดี"
                      className="w-full px-4 py-3 rounded-2xl bg-[#F8FBFF] border border-[#D4E8FA] text-base sm:text-sm focus:outline-none focus:bg-white focus:border-[#3B89CC] focus:ring-2 focus:ring-[#D7EDFF]"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs sm:text-sm font-medium text-[#2A496B] mb-1.5">
                        เบอร์โทรศัพท์ <span className="text-[#D63653]">*</span>
                      </label>
                      <input
                        type="tel"
                        required
                        value={customerPhone}
                        onChange={(e) => setCustomerPhone(e.target.value)}
                        placeholder="08X-XXX-XXXX"
                        className="w-full px-4 py-3 rounded-2xl bg-[#F8FBFF] border border-[#D4E8FA] text-base sm:text-sm focus:outline-none focus:bg-white focus:border-[#3B89CC] focus:ring-2 focus:ring-[#D7EDFF]"
                      />
                    </div>
                    <div>
                      <label className="block text-xs sm:text-sm font-medium text-[#2A496B] mb-1.5">
                        ชื่อ Instagram <span className="text-[#D63653]">*</span>
                      </label>
                      <input
                        type="text"
                        required
                        value={customerInstagram}
                        onChange={(e) => setCustomerInstagram(e.target.value)}
                        placeholder="@your_instagram"
                        className="w-full px-4 py-3 rounded-2xl bg-[#F8FBFF] border border-[#D4E8FA] text-base sm:text-sm focus:outline-none focus:bg-white focus:border-[#3B89CC] focus:ring-2 focus:ring-[#D7EDFF]"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs sm:text-sm font-medium text-[#2A496B] mb-1.5">
                      ที่อยู่จัดส่ง <span className="text-[#D63653]">*</span>
                    </label>
                    <textarea
                      required
                      rows={3}
                      value={customerAddress}
                      onChange={(e) => setCustomerAddress(e.target.value)}
                      placeholder="บ้านเลขที่ อาคาร ซอย ถนน แขวง/ตำบล เขต/อำเภอ จังหวัด รหัสไปรษณีย์"
                      className="w-full px-4 py-3 rounded-2xl bg-[#F8FBFF] border border-[#D4E8FA] text-base sm:text-sm focus:outline-none focus:bg-white focus:border-[#3B89CC] focus:ring-2 focus:ring-[#D7EDFF]"
                    />
                  </div>

                  <div>
                    <label className="block text-xs sm:text-sm font-medium text-[#2A496B] mb-1.5">
                      หมายเหตุเพิ่มเติม (ไม่บังคับ)
                    </label>
                    <input
                      type="text"
                      value={orderNote}
                      onChange={(e) => setOrderNote(e.target.value)}
                      placeholder="เช่น เขียนการ์ดอวยพร หรือเวลาที่สะดวกรับ"
                      className="w-full px-4 py-3 rounded-2xl bg-[#F8FBFF] border border-[#D4E8FA] text-base sm:text-sm focus:outline-none focus:bg-white focus:border-[#3B89CC] focus:ring-2 focus:ring-[#D7EDFF]"
                    />
                  </div>
                </div>
              </div>

              {/* Order Summary & Confirmation */}
              <div className="lg:col-span-5 bakery-card rounded-3xl p-4 sm:p-6">
                <h2 className="text-base sm:text-lg font-semibold text-[#1C3554]">สรุปรายการสินค้า</h2>

                <div className="mt-3 sm:mt-4 divide-y divide-[#EEF5FC] max-h-72 overflow-y-auto pr-1">
                  {cartDetails.map(({ product, quantity, lineTotal }) => (
                    <div key={product.id} className="py-2.5 sm:py-3 flex items-center gap-3">
                      <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-xl overflow-hidden bg-[#F1F8FF] shrink-0">
                        <SafeImage
                          src={product.primary_image}
                          alt={product.name}
                          className="w-full h-full object-cover"
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-[#1C3554] line-clamp-2 leading-snug">
                          {product.name}
                        </p>
                        <p className="text-xs text-[#567394] tabular-nums mt-0.5">
                          {quantity} ชิ้น × {product.price.toLocaleString()} บาท
                        </p>
                      </div>
                      <p className="text-sm font-bold text-[#1C3554] tabular-nums shrink-0 whitespace-nowrap">
                        {lineTotal.toLocaleString()} ฿
                      </p>
                    </div>
                  ))}
                </div>

                <div className="mt-4 pt-4 border-t border-[#E4F0FB] space-y-2 text-sm">
                  <div className="flex justify-between text-[#4A688A]">
                    <span>ยอดสินค้า</span>
                    <span className="font-medium text-[#1C3554] tabular-nums">
                      {cartSubtotal.toLocaleString()} บาท
                    </span>
                  </div>
                  <div className="flex justify-between text-[#4A688A]">
                    <span>ค่าจัดส่ง</span>
                    <span className="font-medium text-[#1C3554] tabular-nums">
                      {computedShippingFee === null
                        ? 'รอยืนยัน'
                        : computedShippingFee === 0
                        ? 'ฟรีค่าจัดส่ง ♡'
                        : `${computedShippingFee.toLocaleString()} บาท`}
                    </span>
                  </div>
                  <div className="pt-2 border-t border-[#E4F0FB] flex justify-between items-baseline">
                    <span className="text-sm sm:text-base font-semibold text-[#1C3554]">ยอดรวมสุทธิ</span>
                    <span className="text-xl sm:text-2xl font-bold text-[#2F7CC0] tabular-nums">
                      {grandTotal.toLocaleString()} บาท
                    </span>
                  </div>
                </div>

                <label className="mt-4 sm:mt-5 flex items-start gap-3 p-3.5 rounded-2xl bg-[#F4F9FF] border border-[#DCECFB] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={confirmChecked}
                    onChange={(e) => setConfirmChecked(e.target.checked)}
                    className="mt-0.5 w-4 h-4 rounded accent-[#3B89CC] shrink-0"
                  />
                  <span className="text-xs leading-relaxed text-[#2C4C70]">
                    ฉันตรวจสอบข้อมูลและรายการสั่งซื้อเรียบร้อยแล้ว
                  </span>
                </label>

                <button
                  type="submit"
                  disabled={submittingOrder || !confirmChecked}
                  className="mt-4 sm:mt-5 w-full h-12 rounded-2xl bg-[#3B89CC] hover:bg-[#2E76B6] text-white text-sm font-semibold transition-colors disabled:opacity-50 cursor-pointer"
                >
                  {submittingOrder ? 'กำลังบันทึกออเดอร์...' : 'ยืนยันออเดอร์ 💙'}
                </button>
              </div>
            </form>
          </section>
        )}

        {/* ================= PAGE 4: ORDER SUCCESS ================= */}
        {page === 'success' && completedOrder && (
          <section className="max-w-2xl mx-auto px-4 sm:px-6 py-6 sm:py-12">
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
              className="bakery-card rounded-3xl sm:rounded-[32px] p-5 sm:p-10 text-center relative overflow-hidden"
            >
              {/* Floating Pastel Hearts & Stars Animation */}
              <div className="flex items-center justify-center gap-4 mb-3 sm:mb-4">
                <motion.div
                  animate={{ y: [0, -7, 0] }}
                  transition={{ repeat: Infinity, duration: 2.2, ease: 'easeInOut' }}
                >
                  <Star className="w-5 h-5 sm:w-6 sm:h-6 text-[#7CC0F5] fill-[#CFE9FF]" />
                </motion.div>
                <motion.div
                  initial={{ scale: 0.5 }}
                  animate={{ scale: 1 }}
                  transition={{ type: 'spring', stiffness: 260, damping: 18 }}
                  className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl sm:rounded-3xl bg-[#E4F3FF] text-[#2F7CC0] flex items-center justify-center shadow-sm"
                >
                  <CheckCircle2 className="w-8 h-8 sm:w-9 sm:h-9" />
                </motion.div>
                <motion.div
                  animate={{ y: [0, -7, 0] }}
                  transition={{ repeat: Infinity, duration: 2.2, delay: 0.4, ease: 'easeInOut' }}
                >
                  <Heart className="w-5 h-5 sm:w-6 sm:h-6 text-[#5CA9E6] fill-[#BEE2FF]" />
                </motion.div>
              </div>

              <h1 className="text-xl sm:text-3xl font-bold text-[#1C3554]">
                สั่งซื้อสำเร็จแล้ว! 🎉
              </h1>
              <p className="mt-1 text-sm sm:text-base text-[#4A688A]">
                ทางร้านได้รับออเดอร์ของคุณเรียบร้อยแล้ว ขอบคุณที่อุดหนุน Bibi&apos;s Treats ♡
              </p>

              {/* Post-Purchase Important Reminder Alert */}
              <div
                role="status"
                className="mt-4 sm:mt-5 rounded-2xl bg-[#FFF9EB] border border-[#F5DDA7] p-3.5 sm:p-4 text-left flex items-start gap-3"
              >
                <div className="w-8 h-8 rounded-xl bg-[#FCEBC2] text-[#9A5B00] flex items-center justify-center shrink-0 mt-0.5">
                  <Bell className="w-4 h-4" />
                </div>
                <div className="min-w-0 space-y-1 text-xs sm:text-[13px] leading-relaxed text-[#6E4506]">
                  <p className="font-bold text-[#7C4A03]">
                    คำแจ้งเตือนหลังสั่งซื้อสำเร็จ 🩵
                  </p>
                  <p>
                    • กรุณา<strong>แคปหน้าจอนี้</strong>หรือบันทึกเลขที่ออเดอร์{' '}
                    <span className="font-mono font-bold text-[#2F7CC0]">
                      {completedOrder.order_number}
                    </span>{' '}
                    ไว้สำหรับตรวจสอบสถานะ
                  </p>
                  <p>
                    • ทางร้านจะติดต่อยืนยันออเดอร์และแจ้งรายละเอียดการชำระเงินทาง{' '}
                    <strong className="break-words">{completedOrder.customer_instagram}</strong>{' '}
                    หรือเบอร์{' '}
                    <strong className="tabular-nums">{completedOrder.customer_phone}</strong>{' '}
                    โดยเร็วที่สุด
                  </p>
                  <p>
                    • หากต้องการแก้ไขรายการหรือที่อยู่จัดส่ง กรุณาแจ้งทางร้านพร้อมระบุเลขที่ออเดอร์ทันที
                  </p>
                </div>
              </div>

              <div className="mt-4 sm:mt-5 rounded-2xl bg-[#F4F9FF] border border-[#D8EBFB] p-4 sm:p-5 text-left space-y-3">
                <div className="flex items-start justify-between gap-3 pb-3 border-b border-[#E1EFFB]">
                  <div className="min-w-0">
                    <p className="text-[11px] sm:text-xs text-[#567394]">เลขที่ออเดอร์</p>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2">
                      <p className="text-lg sm:text-xl font-bold font-mono text-[#2F7CC0] tabular-nums">
                        {completedOrder.order_number}
                      </p>
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(completedOrder.order_number);
                            setCopiedOrderNo(true);
                            showToast(`คัดลอกเลขที่ออเดอร์ ${completedOrder.order_number} แล้ว`);
                            window.setTimeout(() => setCopiedOrderNo(false), 2200);
                          } catch {
                            showToast(`เลขที่ออเดอร์ของคุณคือ ${completedOrder.order_number}`);
                          }
                        }}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white border border-[#CFE6FA] hover:bg-[#EAF5FF] text-[11px] font-semibold text-[#2F7CC0] transition-colors cursor-pointer"
                      >
                        {copiedOrderNo ? (
                          <>
                            <Check className="w-3 h-3 text-[#17693B]" />
                            <span className="text-[#17693B]">คัดลอกแล้ว</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3" />
                            <span>คัดลอก</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-[11px] sm:text-xs text-[#567394]">สถานะปัจจุบัน</p>
                    <p className="text-xs sm:text-sm font-semibold text-[#9A5B00]">
                      {ORDER_STATUS_META[completedOrder.status].label}
                    </p>
                  </div>
                </div>

                <p className="text-[11px] sm:text-xs text-[#567394] font-mono tabular-nums">
                  วันที่และเวลาสั่งซื้อ: {completedOrder.created_at}
                </p>

                <div className="divide-y divide-[#E4F0FB]">
                  {completedOrder.items.map((it) => (
                    <div key={it.id} className="py-2 flex items-start justify-between gap-3 text-xs sm:text-sm">
                      <span className="text-[#1C3554] min-w-0 leading-snug">
                        {it.product_name} × <span className="tabular-nums font-medium">{it.quantity}</span>
                      </span>
                      <span className="font-semibold text-[#1C3554] tabular-nums shrink-0 whitespace-nowrap">
                        {it.subtotal.toLocaleString()} บาท
                      </span>
                    </div>
                  ))}
                </div>

                <div className="pt-3 border-t border-[#DCECFB] space-y-1.5 text-xs sm:text-sm">
                  <div className="flex justify-between text-[#567394]">
                    <span>ค่าจัดส่ง</span>
                    <span className="tabular-nums">
                      {completedOrder.shipping_fee === null
                        ? 'รอยืนยัน'
                        : completedOrder.shipping_fee === 0
                        ? 'ฟรี'
                        : `${completedOrder.shipping_fee.toLocaleString()} บาท`}
                    </span>
                  </div>
                  <div className="flex justify-between items-baseline text-sm sm:text-base font-bold text-[#1C3554]">
                    <span>ยอดรวมทั้งหมด</span>
                    <span className="text-base sm:text-lg text-[#2F7CC0] tabular-nums">
                      {completedOrder.total.toLocaleString()} บาท
                    </span>
                  </div>
                </div>
              </div>

              <div className="mt-5 sm:mt-7 flex flex-col sm:flex-row items-center justify-center gap-2.5 sm:gap-3">
                <button
                  type="button"
                  onClick={() => setPage('home')}
                  className="w-full sm:w-auto px-6 py-3 rounded-2xl bg-[#EFF7FF] hover:bg-[#E1F0FE] text-[#2F7CC0] text-sm font-semibold transition-colors cursor-pointer"
                >
                  กลับหน้าหลัก
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setTrackedOrder(completedOrder);
                    setPage('track');
                  }}
                  className="w-full sm:w-auto px-6 py-3 rounded-2xl bg-[#3B89CC] hover:bg-[#2E76B6] text-white text-sm font-semibold transition-colors cursor-pointer"
                >
                  ตรวจสอบออเดอร์
                </button>
              </div>
            </motion.div>
          </section>
        )}

        {/* ================= PAGE 6: ORDER TRACKING ================= */}
        {page === 'track' && (
          <section className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
            <div className="text-center max-w-lg mx-auto">
              <p className="text-xs font-medium text-[#567394] leading-relaxed">
                กรอกเลขที่ออเดอร์และเบอร์โทรศัพท์เพื่อยืนยันตัวตนและดูสถานะ
              </p>
              <h1 className="mt-1 text-xl sm:text-3xl font-bold text-[#1C3554]">
                📦 ตรวจสอบออเดอร์ของคุณ
              </h1>
            </div>

            <form
              onSubmit={handleTrackOrder}
              className="mt-5 sm:mt-7 bakery-card rounded-3xl p-4 sm:p-6 space-y-4"
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 sm:gap-4">
                <div>
                  <label className="block text-xs font-medium text-[#4A688A] mb-1.5">
                    เลขที่ออเดอร์
                  </label>
                  <input
                    type="text"
                    value={trackOrderNumber}
                    onChange={(e) => setTrackOrderNumber(e.target.value)}
                    placeholder="เช่น BT-0001"
                    className="w-full px-4 py-3 rounded-2xl bg-[#F8FBFF] border border-[#D4E8FA] text-base sm:text-sm font-mono uppercase focus:outline-none focus:bg-white focus:border-[#3B89CC]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#4A688A] mb-1.5">
                    เบอร์โทรศัพท์ที่ใช้สั่งซื้อ
                  </label>
                  <input
                    type="tel"
                    value={trackPhone}
                    onChange={(e) => setTrackPhone(e.target.value)}
                    placeholder="เช่น 0891234567"
                    className="w-full px-4 py-3 rounded-2xl bg-[#F8FBFF] border border-[#D4E8FA] text-base sm:text-sm focus:outline-none focus:bg-white focus:border-[#3B89CC]"
                  />
                </div>
              </div>

              {trackError && (
                <p className="text-xs sm:text-sm text-[#B4233C] bg-[#FFF0F3] border border-[#F7C5D0] rounded-2xl px-4 py-2.5">
                  {trackError}
                </p>
              )}

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
                <span className="text-xs text-[#6B89A8] flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5 shrink-0" />
                  ปกป้องข้อมูลส่วนตัวด้วยเบอร์โทรศัพท์ผู้สั่งซื้อ
                </span>
                <button
                  type="submit"
                  disabled={trackingLoading}
                  className="w-full sm:w-auto px-6 py-3 rounded-2xl bg-[#3B89CC] hover:bg-[#2E76B6] text-white text-sm font-semibold transition-colors disabled:opacity-60 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  {trackingLoading ? 'กำลังค้นหา...' : 'ค้นหาออเดอร์'}
                </button>
              </div>
            </form>

            {trackedOrder && (
              <div className="mt-5 sm:mt-6 bakery-card rounded-3xl p-4 sm:p-7 space-y-5 sm:space-y-6">
                <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-[#E6F1FC]">
                  <div>
                    <p className="text-xs text-[#567394]">เลขที่ออเดอร์</p>
                    <h2 className="text-xl sm:text-2xl font-bold font-mono text-[#2F7CC0] tabular-nums">
                      {trackedOrder.order_number}
                    </h2>
                    <p className="text-xs text-[#567394] mt-0.5 font-mono tabular-nums">
                      สั่งซื้อเมื่อ {trackedOrder.created_at}
                    </p>
                  </div>
                  <div className="text-right">
                    <span
                      className={`inline-block px-3.5 py-1.5 rounded-xl text-xs sm:text-sm font-semibold ${
                        ORDER_STATUS_META[trackedOrder.status].colorClass
                      }`}
                    >
                      {ORDER_STATUS_META[trackedOrder.status].label}
                    </span>
                  </div>
                </div>

                {/* Progress Timeline: Vertical on mobile (no squished Thai text), Horizontal 5-col on sm+ */}
                {trackedOrder.status === 'cancelled' ? (
                  <div className="rounded-2xl bg-[#FFF0F3] border border-[#F8C8D4] p-4 text-xs sm:text-sm text-[#B4233C] leading-relaxed">
                    ออเดอร์นี้ถูกยกเลิกแล้ว หากมีข้อสงสัยสามารถติดต่อร้านทาง Instagram ได้เลยค่ะ
                  </div>
                ) : (
                  <>
                    {/* Mobile Vertical Stepper */}
                    <div className="sm:hidden space-y-2.5">
                      {PROGRESS_STEPS.map((st, idx) => {
                        const currentStep = ORDER_STATUS_META[trackedOrder.status].stepIndex;
                        const done = idx <= currentStep;
                        const isCurrent = idx === currentStep;
                        return (
                          <div key={st} className="flex items-center gap-3">
                            <div
                              className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 ${
                                done
                                  ? 'bg-[#3B89CC] text-white'
                                  : 'bg-[#E8F2FC] text-[#89A3BE]'
                              }`}
                            >
                              {idx + 1}
                            </div>
                            <span
                              className={`text-sm ${
                                isCurrent
                                  ? 'font-bold text-[#2F7CC0]'
                                  : done
                                  ? 'font-medium text-[#1C3554]'
                                  : 'text-[#89A3BE]'
                              }`}
                            >
                              {ORDER_STATUS_META[st].label}
                            </span>
                            {isCurrent && (
                              <span className="ml-auto text-[11px] font-medium text-[#3B89CC]">
                                สถานะปัจจุบัน
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {/* Tablet/Desktop Horizontal Stepper */}
                    <div className="hidden sm:grid sm:grid-cols-5 gap-2">
                      {PROGRESS_STEPS.map((st, idx) => {
                        const currentStep = ORDER_STATUS_META[trackedOrder.status].stepIndex;
                        const done = idx <= currentStep;
                        return (
                          <div key={st} className="text-center">
                            <div
                              className={`h-2 rounded-full transition-colors ${
                                done ? 'bg-[#3B89CC]' : 'bg-[#E2EFFB]'
                              }`}
                            />
                            <p
                              className={`mt-2 text-xs leading-tight ${
                                done ? 'font-semibold text-[#1C3554]' : 'text-[#89A3BE]'
                              }`}
                            >
                              {ORDER_STATUS_META[st].label}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}

                {/* Items & Total */}
                <div className="space-y-2.5 pt-2 border-t border-[#E6F1FC]">
                  <h3 className="text-sm font-semibold text-[#1C3554]">รายการสินค้า</h3>
                  {trackedOrder.items.map((item) => (
                    <div key={item.id} className="flex items-center justify-between gap-3 text-sm py-1.5">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-11 h-11 rounded-xl overflow-hidden bg-[#F1F8FF] shrink-0">
                          <SafeImage
                            src={item.product_image}
                            alt={item.product_name}
                            className="w-full h-full object-cover"
                          />
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs sm:text-sm font-medium text-[#1C3554] line-clamp-2">
                            {item.product_name}
                          </p>
                          <p className="text-[11px] sm:text-xs text-[#567394] tabular-nums">
                            {item.quantity} ชิ้น × {item.price.toLocaleString()} บาท
                          </p>
                        </div>
                      </div>
                      <span className="text-xs sm:text-sm font-semibold text-[#1C3554] tabular-nums shrink-0">
                        {item.subtotal.toLocaleString()} บาท
                      </span>
                    </div>
                  ))}
                </div>

                <div className="pt-4 border-t border-[#E6F1FC] space-y-1.5 text-xs sm:text-sm">
                  <div className="flex justify-between text-[#567394]">
                    <span>ยอดสินค้า</span>
                    <span className="tabular-nums">{trackedOrder.subtotal.toLocaleString()} บาท</span>
                  </div>
                  <div className="flex justify-between text-[#567394]">
                    <span>ค่าจัดส่ง</span>
                    <span className="tabular-nums">
                      {trackedOrder.shipping_fee === null
                        ? 'รอยืนยัน'
                        : trackedOrder.shipping_fee === 0
                        ? 'ฟรี'
                        : `${trackedOrder.shipping_fee.toLocaleString()} บาท`}
                    </span>
                  </div>
                  <div className="flex justify-between text-base sm:text-lg font-bold text-[#1C3554] pt-2 border-t border-[#EEF5FC]">
                    <span>ยอดชำระสุทธิ</span>
                    <span className="text-[#2F7CC0] tabular-nums">
                      {trackedOrder.total.toLocaleString()} บาท
                    </span>
                  </div>
                </div>
              </div>
            )}
          </section>
        )}
      </main>

      {/* Quiet Footer */}
      <footer className="mt-12 border-t border-[#E3F0FC] bg-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-[#567394]">
          <div className="flex flex-wrap items-center justify-center gap-2">
            {storeConfig.store_logo_url && (
              <SafeImage
                src={storeConfig.store_logo_url}
                alt="โลโก้ร้าน Bibi's Treats"
                className="w-6 h-6 rounded-lg object-cover border border-[#DCECFB] shrink-0"
              />
            )}
            <span className="font-display text-sm font-semibold text-[#1C3554]">
              Bibi&apos;s Treats 🩵
            </span>
            <span>·</span>
            <span>Sweet treats, happy hearts ♡</span>
          </div>
          <div className="flex items-center gap-5">
            <button
              type="button"
              onClick={() => setPage('track')}
              className="hover:text-[#2F7CC0] cursor-pointer"
            >
              ตรวจสอบออเดอร์
            </button>
            <button
              type="button"
              onClick={onOpenAdmin}
              className="hover:text-[#2F7CC0] cursor-pointer"
            >
              ระบบจัดการร้าน (Admin)
            </button>
          </div>
        </div>
      </footer>

      {/* Mobile Bottom Navigation (compact <= 15% viewport height with safe-area padding) */}
      <nav
        aria-label="เมนูหลักมือถือ"
        className="md:hidden fixed bottom-0 inset-x-0 z-30 min-h-[56px] pb-safe bg-white/95 backdrop-blur-md border-t border-[#DFEEFB] grid grid-cols-4 px-1"
      >
        <button
          type="button"
          onClick={() => {
            setPage('home');
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
          className={`flex flex-col items-center justify-center py-2 gap-0.5 text-[11px] leading-none font-medium ${
            page === 'home' ? 'text-[#2F7CC0]' : 'text-[#6B89A8]'
          }`}
        >
          <Home className="w-5 h-5" />
          <span>หน้าแรก</span>
        </button>

        <button
          type="button"
          onClick={goToMenu}
          className="flex flex-col items-center justify-center py-2 gap-0.5 text-[11px] leading-none font-medium text-[#6B89A8]"
        >
          <UtensilsCrossed className="w-5 h-5" />
          <span>เมนู</span>
        </button>

        <button
          type="button"
          onClick={() => {
            setPage('cart');
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
          className={`relative flex flex-col items-center justify-center py-2 gap-0.5 text-[11px] leading-none font-medium ${
            page === 'cart' || page === 'checkout' ? 'text-[#2F7CC0]' : 'text-[#6B89A8]'
          }`}
        >
          <div className="relative">
            <ShoppingCart className="w-5 h-5" />
            {totalCartItems > 0 && (
              <span className="absolute -top-1.5 -right-2.5 min-w-[18px] h-[18px] px-1 rounded-full bg-[#3B89CC] text-white text-[10px] font-bold flex items-center justify-center tabular-nums">
                {totalCartItems}
              </span>
            )}
          </div>
          <span>ตะกร้า</span>
        </button>

        <button
          type="button"
          onClick={() => {
            setPage('track');
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
          className={`flex flex-col items-center justify-center py-2 gap-0.5 text-[11px] leading-none font-medium ${
            page === 'track' || page === 'success' ? 'text-[#2F7CC0]' : 'text-[#6B89A8]'
          }`}
        >
          <PackageSearch className="w-5 h-5" />
          <span>ออเดอร์</span>
        </button>
      </nav>

      {/* Multi-Image Product Gallery Modal */}
      <ProductGalleryModal
        product={selectedProduct}
        cartQuantity={selectedProduct ? getCartQty(selectedProduct.id) : 0}
        onClose={() => setSelectedProduct(null)}
        onAddToCart={handleAddToCart}
      />
    </div>
  );
};
