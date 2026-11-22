import React, { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Minus, Plus, ShoppingCart, X } from 'lucide-react';
import type { Product } from '../types';
import { SafeImage } from './SafeImage';

interface ProductGalleryModalProps {
  product: Product | null;
  cartQuantity: number;
  onClose: () => void;
  onAddToCart: (product: Product, qty: number) => void;
}

export const ProductGalleryModal: React.FC<ProductGalleryModalProps> = ({
  product,
  cartQuantity,
  onClose,
  onAddToCart,
}) => {
  const [activeIndex, setActiveIndex] = useState(0);
  const [qty, setQty] = useState(1);

  useEffect(() => {
    setActiveIndex(0);
    setQty(1);
  }, [product?.id]);

  if (!product) return null;

  const images =
    product.images.length > 0
      ? product.images
      : product.primary_image
      ? [{ id: 0, image_url: product.primary_image }]
      : [];

  const maxAddable = Math.max(0, product.stock - cartQuantity);
  const isSoldOut = product.stock <= 0 || product.status !== 'active';

  const handlePrev = () => {
    if (images.length <= 1) return;
    setActiveIndex((prev) => (prev - 1 + images.length) % images.length);
  };

  const handleNext = () => {
    if (images.length <= 1) return;
    setActiveIndex((prev) => (prev + 1) % images.length);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-[#1C3554]/45 backdrop-blur-[3px] p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={product.name}
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl max-h-[92vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl bg-white border border-[#DCECFB] shadow-2xl grid grid-cols-1 md:grid-cols-2"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Left: Image Slider */}
        <div className="bg-[#F4F9FF] flex flex-col">
          <div className="relative aspect-[4/3] w-full overflow-hidden">
            <SafeImage
              src={images[activeIndex]?.image_url}
              alt={`${product.name} รูปที่ ${activeIndex + 1}`}
              className="w-full h-full object-cover"
              fallbackLabel={product.name}
            />
            <button
              type="button"
              onClick={onClose}
              className="md:hidden absolute top-3 right-3 w-9 h-9 rounded-full bg-white/92 text-[#1C3554] shadow-md flex items-center justify-center"
              aria-label="ปิดหน้าต่าง"
            >
              <X className="w-4 h-4" />
            </button>
            {images.length > 1 && (
              <>
                <button
                  type="button"
                  onClick={handlePrev}
                  className="absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/90 text-[#1C3554] shadow-md flex items-center justify-center hover:bg-white transition-colors"
                  aria-label="รูปก่อนหน้า"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <button
                  type="button"
                  onClick={handleNext}
                  className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/90 text-[#1C3554] shadow-md flex items-center justify-center hover:bg-white transition-colors"
                  aria-label="รูปถัดไป"
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
                <div className="absolute bottom-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-[#1C3554]/65 text-white text-xs font-mono tabular-nums">
                  {activeIndex + 1} / {images.length}
                </div>
              </>
            )}
          </div>

          {images.length > 1 && (
            <div className="flex items-center gap-2 p-3 overflow-x-auto bg-white border-t border-[#E6F1FC]">
              {images.map((img, idx) => (
                <button
                  key={img.id || idx}
                  type="button"
                  onClick={() => setActiveIndex(idx)}
                  className={`w-14 h-11 sm:w-16 sm:h-12 rounded-xl overflow-hidden shrink-0 border-2 transition-all ${
                    idx === activeIndex
                      ? 'border-[#3B89CC] ring-2 ring-[#CFE8FF]'
                      : 'border-transparent opacity-70 hover:opacity-100'
                  }`}
                >
                  <SafeImage
                    src={img.image_url}
                    alt={`${product.name} ย่อ ${idx + 1}`}
                    className="w-full h-full object-cover"
                  />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Right: Contiguous Purchase Module */}
        <div className="p-4 sm:p-6 pb-6 flex flex-col justify-between">
          <div>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-medium text-[#567394]">{product.category}</p>
                <h3 className="mt-1 text-lg sm:text-xl font-semibold text-[#1C3554] leading-snug">
                  {product.name}
                </h3>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="hidden md:flex p-2 rounded-xl text-[#567394] hover:bg-[#EDF6FF] transition-colors shrink-0"
                aria-label="ปิดหน้าต่าง"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="mt-2.5 text-sm leading-relaxed text-[#4B6889]">
              {product.description || 'ขนมโฮมเมดอบสดใหม่จากเตาทุกวัน ใส่ใจทุกรายละเอียด ♡'}
            </p>

            <div className="mt-4 flex items-baseline justify-between border-y border-[#E9F3FC] py-3.5">
              <div>
                <span className="text-xs text-[#567394]">ราคาต่อชิ้น</span>
                <p className="text-xl sm:text-2xl font-bold text-[#2F7CC0] tabular-nums">
                  {product.price.toLocaleString()} บาท
                </p>
              </div>
              <div className="text-right">
                {isSoldOut ? (
                  <span className="text-sm font-semibold text-[#C42746]">SOLD OUT ♡</span>
                ) : (
                  <>
                    <span className="text-xs text-[#567394]">จำนวนคงเหลือ</span>
                    <p className="text-sm font-semibold text-[#1C3554] tabular-nums">
                      เหลือ {product.stock} ชิ้น
                    </p>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="mt-6 space-y-3">
            {!isSoldOut ? (
              <>
                {cartQuantity > 0 && (
                  <p className="text-xs text-[#3B89CC]">
                    อยู่ในตะกร้าแล้ว {cartQuantity} ชิ้น (เพิ่มได้อีก {maxAddable} ชิ้น)
                  </p>
                )}
                <div className="flex items-center gap-3">
                  <div className="flex items-center border border-[#D4E8FA] rounded-2xl bg-[#F8FBFF]">
                    <button
                      type="button"
                      onClick={() => setQty((q) => Math.max(1, q - 1))}
                      disabled={qty <= 1}
                      className="w-11 h-11 flex items-center justify-center text-[#1C3554] hover:bg-[#E6F3FF] rounded-l-2xl disabled:opacity-40"
                      aria-label="ลดจำนวน"
                    >
                      <Minus className="w-4 h-4" />
                    </button>
                    <span className="w-10 text-center text-sm font-semibold tabular-nums">
                      {qty}
                    </span>
                    <button
                      type="button"
                      onClick={() => setQty((q) => Math.min(Math.max(1, maxAddable), q + 1))}
                      disabled={qty >= maxAddable}
                      className="w-11 h-11 flex items-center justify-center text-[#1C3554] hover:bg-[#E6F3FF] rounded-r-2xl disabled:opacity-40"
                      aria-label="เพิ่มจำนวน"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>

                  <button
                    type="button"
                    disabled={maxAddable <= 0}
                    onClick={() => {
                      onAddToCart(product, Math.min(qty, maxAddable));
                      onClose();
                    }}
                    className="flex-1 h-11 px-5 rounded-2xl bg-[#3B89CC] hover:bg-[#2E76B6] text-white text-sm font-semibold flex items-center justify-center gap-2 transition-colors disabled:opacity-50 whitespace-nowrap"
                  >
                    <ShoppingCart className="w-4 h-4" />
                    {maxAddable <= 0 ? 'ครบจำนวนคงเหลือแล้ว' : 'เพิ่มลงตะกร้า'}
                  </button>
                </div>
              </>
            ) : (
              <button
                type="button"
                disabled
                className="w-full h-11 rounded-2xl bg-[#EEF3F8] text-[#849BB3] text-sm font-semibold cursor-not-allowed"
              >
                SOLD OUT ♡ ขนมรอบนี้หมดแล้ว
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
