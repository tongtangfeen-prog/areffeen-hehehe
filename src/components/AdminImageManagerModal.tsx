import React, { useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  CloudUpload,
  ImagePlus,
  RefreshCw,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import {
  deleteProductImage,
  linkImageDriveFileId,
  reorderProductImages,
  replaceProductImage,
  setPrimaryProductImage,
  uploadProductImages,
} from '../lib/api';
import {
  ensureBakeryDriveFolder,
  getWorkspaceAccessToken,
  uploadImageBlobToDrive,
} from '../lib/workspaceAuth';
import type { Product, ProductImage } from '../types';
import { ConfirmDialog } from './ConfirmDialog';
import { SafeImage } from './SafeImage';

interface AdminImageManagerModalProps {
  product: Product | null;
  driveFolderId: string;
  onSaveDriveFolderId: (folderId: string) => Promise<void>;
  onProductUpdated: (updated: Product) => void;
  onClose: () => void;
}

const ALLOWED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
const MAX_SIZE_BYTES = 5 * 1024 * 1024;

export const AdminImageManagerModal: React.FC<AdminImageManagerModalProps> = ({
  product,
  driveFolderId,
  onSaveDriveFolderId,
  onProductUpdated,
  onClose,
}) => {
  const [pendingFiles, setPendingFiles] = useState<Array<{ file: File; previewUrl: string }>>([]);
  const [replaceTarget, setReplaceTarget] = useState<ProductImage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [confirmState, setConfirmState] = useState<{
    open: boolean;
    title: string;
    description: string;
    confirmLabel: string;
    tone: 'danger' | 'primary';
    onConfirm: () => Promise<void>;
  } | null>(null);

  const addInputRef = useRef<HTMLInputElement | null>(null);
  const replaceInputRef = useRef<HTMLInputElement | null>(null);

  if (!product) return null;

  const validateFiles = (files: File[]): string | null => {
    for (const f of files) {
      if (!ALLOWED_TYPES.includes(f.type.toLowerCase())) {
        return `ไฟล์ "${f.name}" ไม่รองรับ (รองรับเฉพาะ JPG, JPEG, PNG, WEBP)`;
      }
      if (f.size > MAX_SIZE_BYTES) {
        return `ไฟล์ "${f.name}" มีขนาดเกิน 5MB`;
      }
    }
    return null;
  };

  const handleSelectAddFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (files.length === 0) return;

    const err = validateFiles(files);
    if (err) {
      setError(err);
      return;
    }

    setError(null);
    const items = files.map((file) => ({
      file,
      previewUrl: URL.createObjectURL(file),
    }));
    setPendingFiles((prev) => [...prev, ...items]);
  };

  const handleUploadPending = async () => {
    if (pendingFiles.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await uploadProductImages(
        product.id,
        pendingFiles.map((p) => p.file)
      );
      pendingFiles.forEach((p) => URL.revokeObjectURL(p.previewUrl));
      setPendingFiles([]);
      onProductUpdated(updated);
      setNotice('อัปโหลดรูปภาพเข้าสู่ระบบเรียบร้อยแล้ว');
    } catch (err: any) {
      setError(err?.message || 'อัปโหลดรูปภาพไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  };

  const handleReplaceFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !replaceTarget) return;

    const err = validateFiles([file]);
    if (err) {
      setError(err);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const updated = await replaceProductImage(replaceTarget.id, file);
      onProductUpdated(updated);
      setNotice('เปลี่ยนรูปภาพเรียบร้อยแล้ว');
    } catch (err: any) {
      setError(err?.message || 'เปลี่ยนรูปภาพไม่สำเร็จ');
    } finally {
      setReplaceTarget(null);
      setBusy(false);
    }
  };

  const handleSetPrimary = async (imageId: number) => {
    setBusy(true);
    setError(null);
    try {
      const updated = await setPrimaryProductImage(imageId);
      onProductUpdated(updated);
      setNotice('ตั้งเป็นรูปหลักของเมนูแล้ว');
    } catch (err: any) {
      setError(err?.message || 'ไม่สามารถตั้งรูปหลักได้');
    } finally {
      setBusy(false);
    }
  };

  const handleMove = async (index: number, direction: -1 | 1) => {
    const nextIdx = index + direction;
    if (nextIdx < 0 || nextIdx >= product.images.length) return;
    const ids = product.images.map((i) => i.id);
    const [moved] = ids.splice(index, 1);
    ids.splice(nextIdx, 0, moved);

    setBusy(true);
    setError(null);
    try {
      const updated = await reorderProductImages(product.id, ids);
      onProductUpdated(updated);
    } catch (err: any) {
      setError(err?.message || 'เรียงลำดับรูปไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  };

  const requestDeleteImage = (img: ProductImage) => {
    setConfirmState({
      open: true,
      title: 'ยืนยันการลบรูปภาพ?',
      description:
        img.is_primary === 1
          ? 'รูปนี้เป็นรูปหลักของเมนู หากลบระบบจะเลือกรูปถัดไปเป็นรูปหลักให้อัตโนมัติ และลบไฟล์ออกจาก Storage'
          : 'รูปภาพนี้จะถูกลบออกจากระบบ Storage และฐานข้อมูลอย่างถาวร',
      confirmLabel: 'ลบรูปภาพ',
      tone: 'danger',
      onConfirm: async () => {
        setBusy(true);
        setError(null);
        try {
          const updated = await deleteProductImage(img.id);
          onProductUpdated(updated);
          setNotice('ลบรูปภาพเรียบร้อยแล้ว');
        } catch (err: any) {
          setError(err?.message || 'ลบรูปภาพไม่สำเร็จ');
        } finally {
          setBusy(false);
          setConfirmState(null);
        }
      },
    });
  };

  const requestBackupToDrive = (img: ProductImage) => {
    const token = getWorkspaceAccessToken();
    if (!token) {
      setError('กรุณาเชื่อมต่อ Google Workspace (Sign in with Google) ในแท็บ "ตั้งค่า & Google" ก่อนสำรองรูปขึ้น Google Drive');
      return;
    }

    setConfirmState({
      open: true,
      title: 'สำรองรูปภาพไปยัง Google Drive?',
      description: `ระบบจะอัปโหลดรูปภาพของเมนู "${product.name}" ไปยังโฟลเดอร์ "Bibi's Treats Photos" ใน Google Drive ของคุณ`,
      confirmLabel: 'อัปโหลดไปยัง Drive',
      tone: 'primary',
      onConfirm: async () => {
        setBusy(true);
        setError(null);
        try {
          const folder = await ensureBakeryDriveFolder(token, driveFolderId || undefined);
          if (folder.id !== driveFolderId) {
            await onSaveDriveFolderId(folder.id);
          }
          const imgRes = await fetch(img.image_url);
          const blob = await imgRes.blob();
          const safeFileName = `${product.name.replace(/[^a-zA-Z0-9ก-๙_-]+/g, '_')}_img_${img.id}.jpg`;
          const uploaded = await uploadImageBlobToDrive(token, folder.id, blob, safeFileName);
          const updated = await linkImageDriveFileId(img.id, uploaded.id);
          onProductUpdated(updated);
          setNotice(`สำรองรูปไปยัง Google Drive ("${uploaded.name}") เรียบร้อยแล้ว`);
        } catch (err: any) {
          setError(err?.message || 'สำรองรูปขึ้น Google Drive ไม่สำเร็จ');
        } finally {
          setBusy(false);
          setConfirmState(null);
        }
      },
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-[#1C3554]/45 backdrop-blur-[2px] p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`จัดการรูปภาพ ${product.name}`}
    >
      <div className="w-full max-w-3xl max-h-[92vh] flex flex-col rounded-t-3xl sm:rounded-3xl bg-white border border-[#DCECFB] shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-4 sm:px-6 py-3.5 sm:py-4 border-b border-[#E5F1FC] flex items-center justify-between gap-3 bg-[#F7FBFF]">
          <div className="min-w-0">
            <p className="text-[11px] sm:text-xs font-medium text-[#567394] leading-snug">
              จัดการรูปสินค้า (JPG, PNG, WEBP ≤ 5MB)
            </p>
            <h3 className="text-base sm:text-lg font-bold text-[#1C3554] truncate">{product.name}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-[#567394] hover:bg-[#E7F3FF] shrink-0 cursor-pointer"
            aria-label="ปิดหน้าต่าง"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-5 flex-1">
          {error && (
            <div className="rounded-2xl bg-[#FFF0F3] border border-[#F8C8D4] px-4 py-3 text-xs sm:text-sm text-[#B4233C]">
              {error}
            </div>
          )}
          {notice && (
            <div className="rounded-2xl bg-[#EAF7F0] border border-[#BEE5CE] px-4 py-3 text-xs sm:text-sm text-[#17693B]">
              {notice}
            </div>
          )}

          {/* Add new images section */}
          <div className="rounded-2xl border border-dashed border-[#A7D3F7] bg-[#F5FAFF] p-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-[#1C3554]">เพิ่มรูปภาพจากมือถือหรือคอมพิวเตอร์</p>
                <p className="text-xs text-[#567394]">เลือกได้หลายรูปพร้อมกัน และดูตัวอย่างก่อนบันทึก</p>
              </div>
              <input
                ref={addInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                onChange={handleSelectAddFiles}
                className="hidden"
              />
              <button
                type="button"
                disabled={busy}
                onClick={() => addInputRef.current?.click()}
                className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-[#3B89CC] hover:bg-[#2E76B6] text-white text-sm font-semibold flex items-center justify-center gap-2 transition-colors whitespace-nowrap cursor-pointer"
              >
                <ImagePlus className="w-4 h-4" />
                ＋ เพิ่มรูปภาพ
              </button>
            </div>

            {pendingFiles.length > 0 && (
              <div className="mt-4 pt-4 border-t border-[#DCECFB]">
                <p className="text-xs font-medium text-[#315072] mb-2.5">
                  ตัวอย่างรูปที่จะอัปโหลด ({pendingFiles.length} รูป)
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  {pendingFiles.map((item, idx) => (
                    <div
                      key={idx}
                      className="relative aspect-[4/3] rounded-xl overflow-hidden border border-[#CFE6FA] bg-white"
                    >
                      <img
                        src={item.previewUrl}
                        alt={`ตัวอย่างรูปใหม่ ${idx + 1}`}
                        className="w-full h-full object-cover"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          URL.revokeObjectURL(item.previewUrl);
                          setPendingFiles((prev) => prev.filter((_, i) => i !== idx));
                        }}
                        className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-[#1C3554]/75 text-white flex items-center justify-center"
                        aria-label="เอาออก"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      pendingFiles.forEach((p) => URL.revokeObjectURL(p.previewUrl));
                      setPendingFiles([]);
                    }}
                    className="px-3.5 py-2 rounded-xl bg-white border border-[#D4E8FA] text-xs font-medium text-[#567394]"
                  >
                    ล้างตัวอย่าง
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={handleUploadPending}
                    className="px-4 py-2 rounded-xl bg-[#3B89CC] hover:bg-[#2E76B6] text-white text-xs font-semibold disabled:opacity-60 cursor-pointer"
                  >
                    {busy ? 'กำลังอัปโหลด...' : `บันทึกรูปภาพ (${pendingFiles.length} รูป)`}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Hidden input for replacing an image */}
          <input
            ref={replaceInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={handleReplaceFileChange}
            className="hidden"
          />

          {/* Existing images grid */}
          <div>
            <h4 className="text-sm font-semibold text-[#1C3554] mb-3">
              รูปภาพปัจจุบัน ({product.images.length} รูป)
            </h4>

            {product.images.length === 0 ? (
              <div className="rounded-2xl border border-[#E5F1FC] p-8 text-center text-sm text-[#567394]">
                ยังไม่มีรูปภาพสำหรับเมนูนี้ กดปุ่ม &ldquo;＋ เพิ่มรูปภาพ&rdquo; ด้านบนได้เลยค่ะ
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                {product.images.map((img, idx) => (
                  <div
                    key={img.id}
                    className={`rounded-2xl border overflow-hidden bg-white flex flex-col ${
                      img.is_primary === 1 ? 'border-[#3B89CC] ring-2 ring-[#D7ECFF]' : 'border-[#E1EFFB]'
                    }`}
                  >
                    <div className="relative aspect-[4/3] bg-[#F2F8FF]">
                      <SafeImage
                        src={img.image_url}
                        alt={`${product.name} รูปที่ ${idx + 1}`}
                        className="w-full h-full object-cover"
                      />
                      <div className="absolute top-2 left-2 px-2 py-0.5 rounded-lg bg-[#1C3554]/75 text-white text-[11px] font-medium">
                        {img.is_primary === 1 ? '⭐ รูปหลัก' : `รูปที่ ${idx + 1}`}
                      </div>
                      {img.drive_file_id && (
                        <div className="absolute top-2 right-2 px-2 py-0.5 rounded-lg bg-white/90 text-[#2F7CC0] text-[10px] font-semibold">
                          Drive ✓
                        </div>
                      )}
                    </div>

                    <div className="p-3 space-y-2">
                      <div className="grid grid-cols-2 gap-1.5">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            setReplaceTarget(img);
                            replaceInputRef.current?.click();
                          }}
                          className="px-2.5 py-1.5 rounded-xl bg-[#EFF7FF] hover:bg-[#E1F0FE] text-[#2F7CC0] text-xs font-medium flex items-center justify-center gap-1 cursor-pointer"
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                          เปลี่ยนรูป
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => requestDeleteImage(img)}
                          className="px-2.5 py-1.5 rounded-xl bg-[#FFF0F3] hover:bg-[#FFE1E8] text-[#C42746] text-xs font-medium flex items-center justify-center gap-1 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          ลบรูป
                        </button>
                      </div>

                      <div className="flex items-center justify-between gap-1.5">
                        {img.is_primary !== 1 ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => handleSetPrimary(img.id)}
                            className="flex-1 px-2.5 py-1.5 rounded-xl border border-[#D4E8FA] hover:bg-[#F5FAFF] text-[#1C3554] text-xs font-medium flex items-center justify-center gap-1 cursor-pointer"
                          >
                            <Star className="w-3.5 h-3.5 text-[#E6A117]" />
                            ตั้งเป็นรูปหลัก
                          </button>
                        ) : (
                          <span className="flex-1 text-center text-[11px] font-semibold text-[#2F7CC0]">
                            แสดงเป็นหน้าปก
                          </span>
                        )}

                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            disabled={busy || idx === 0}
                            onClick={() => handleMove(idx, -1)}
                            className="p-1.5 rounded-lg border border-[#E1EFFB] hover:bg-[#F5FAFF] disabled:opacity-35 cursor-pointer"
                            aria-label="เลื่อนไปซ้าย"
                          >
                            <ArrowLeft className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            disabled={busy || idx === product.images.length - 1}
                            onClick={() => handleMove(idx, 1)}
                            className="p-1.5 rounded-lg border border-[#E1EFFB] hover:bg-[#F5FAFF] disabled:opacity-35 cursor-pointer"
                            aria-label="เลื่อนไปขวา"
                          >
                            <ArrowRight className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => requestBackupToDrive(img)}
                        className="w-full px-2.5 py-1.5 rounded-xl border border-[#DCECFB] hover:bg-[#F5FAFF] text-[#4A688A] text-xs font-medium flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        <CloudUpload className="w-3.5 h-3.5 text-[#3B89CC]" />
                        {img.drive_file_id ? 'อัปโหลดซ้ำขึ้น Google Drive' : 'สำรองขึ้น Google Drive'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-[#E5F1FC] bg-[#F9FCFF] flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2.5 rounded-xl bg-[#3B89CC] hover:bg-[#2E76B6] text-white text-sm font-semibold cursor-pointer"
          >
            เสร็จสิ้น
          </button>
        </div>
      </div>

      {confirmState && (
        <ConfirmDialog
          open={confirmState.open}
          title={confirmState.title}
          description={confirmState.description}
          confirmLabel={confirmState.confirmLabel}
          tone={confirmState.tone}
          busy={busy}
          onConfirm={confirmState.onConfirm}
          onCancel={() => setConfirmState(null)}
        />
      )}
    </div>
  );
};
