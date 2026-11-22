import { initializeApp, getApps } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  type User,
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';
import { ORDER_STATUS_META, type OrderRecord, type SalesReportData } from '../types';

export const SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/spreadsheets',
];

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const auth = getAuth(app);

const provider = new GoogleAuthProvider();
for (const scope of SCOPES) {
  provider.addScope(scope);
}

// Keep Workspace OAuth access token strictly in memory (never localStorage or sessionStorage)
let isSigningIn = false;
let cachedAccessToken: string | null = null;

export function initWorkspaceAuth(
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void
) {
  return onAuthStateChanged(auth, (user: User | null) => {
    if (user) {
      if (cachedAccessToken) {
        onAuthSuccess?.(user, cachedAccessToken);
      } else if (!isSigningIn) {
        cachedAccessToken = null;
        onAuthFailure?.();
      }
    } else {
      cachedAccessToken = null;
      onAuthFailure?.();
    }
  });
}

export async function workspaceGoogleSignIn(): Promise<{
  user: User;
  accessToken: string;
}> {
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('ไม่สามารถรับสิทธิ์เชื่อมต่อ Google Workspace ได้ กรุณาลองใหม่อีกครั้ง');
    }
    cachedAccessToken = credential.accessToken;
    return { user: result.user, accessToken: cachedAccessToken };
  } finally {
    isSigningIn = false;
  }
}

export function getWorkspaceAccessToken(): string | null {
  return cachedAccessToken;
}

export async function workspaceLogout(): Promise<void> {
  await auth.signOut();
  cachedAccessToken = null;
}

// ===================== GOOGLE DRIVE HELPERS =====================

export interface DriveFileItem {
  id: string;
  name: string;
  mimeType: string;
  webViewLink?: string;
  thumbnailLink?: string;
  createdTime?: string;
  size?: string;
}

export async function ensureBakeryDriveFolder(
  accessToken: string,
  existingFolderId?: string
): Promise<{ id: string; name: string }> {
  if (existingFolderId) {
    const checkRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(existingFolderId)}?fields=id,name,trashed`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (checkRes.ok) {
      const folder = await checkRes.json();
      if (!folder.trashed) {
        return { id: folder.id, name: folder.name };
      }
    }
  }

  const createRes = await fetch('https://www.googleapis.com/drive/v3/files?fields=id,name', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: "Bibi's Treats Photos",
      mimeType: 'application/vnd.google-apps.folder',
    }),
  });

  if (!createRes.ok) {
    const errText = await createRes.text();
    throw new Error(`สร้างโฟลเดอร์ Google Drive ไม่สำเร็จ (${createRes.status}): ${errText}`);
  }
  return await createRes.json();
}

export async function uploadImageBlobToDrive(
  accessToken: string,
  folderId: string,
  blob: Blob,
  fileName: string
): Promise<DriveFileItem> {
  const metadata = {
    name: fileName,
    parents: [folderId],
  };

  const form = new FormData();
  form.append(
    'metadata',
    new Blob([JSON.stringify(metadata)], { type: 'application/json' })
  );
  form.append('file', blob, fileName);

  const res = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,webViewLink,thumbnailLink,createdTime,size',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      body: form,
    }
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`อัปโหลดรูปไปยัง Google Drive ไม่สำเร็จ (${res.status}): ${errText}`);
  }
  return await res.json();
}

export async function listDriveFolderFiles(
  accessToken: string,
  folderId: string
): Promise<DriveFileItem[]> {
  const q = `'${folderId.replace(/'/g, "\\'")}' in parents and trashed = false`;
  const params = new URLSearchParams({
    q,
    fields: 'files(id,name,mimeType,webViewLink,thumbnailLink,createdTime,size)',
    orderBy: 'createdTime desc',
    pageSize: '30',
  });

  const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`ไม่สามารถดึงรายการไฟล์จาก Google Drive ได้ (${res.status})`);
  }
  const data = await res.json();
  return data.files || [];
}

export async function deleteDriveFileById(
  accessToken: string,
  fileId: string
): Promise<void> {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );
  if (!res.ok && res.status !== 404) {
    throw new Error(`ลบไฟล์บน Google Drive ไม่สำเร็จ (${res.status})`);
  }
}

// ===================== GOOGLE SHEETS HELPERS =====================

export async function createBakerySpreadsheet(
  accessToken: string
): Promise<{ spreadsheetId: string; spreadsheetUrl: string }> {
  const res = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      properties: {
        title: "Bibi's Treats — Orders & Sales",
      },
      sheets: [
        { properties: { title: 'Orders' } },
        { properties: { title: 'Sales Summary' } },
      ],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`สร้าง Google Sheet ไม่สำเร็จ (${res.status}): ${errText}`);
  }

  const data = await res.json();
  return {
    spreadsheetId: data.spreadsheetId,
    spreadsheetUrl: data.spreadsheetUrl,
  };
}

export async function syncOrdersToGoogleSheet(
  accessToken: string,
  spreadsheetId: string,
  orders: OrderRecord[],
  sales?: SalesReportData
): Promise<{ syncedRows: number; primarySheetTitle: string }> {
  // Always inspect actual tab names first (never hardcode "Sheet1")
  const metaRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=sheets.properties.title`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!metaRes.ok) {
    throw new Error(`ไม่สามารถเข้าถึง Google Sheet นี้ได้ (${metaRes.status})`);
  }
  const metaData = await metaRes.json();
  const sheetTitles: string[] = (metaData.sheets || []).map(
    (s: any) => s.properties?.title || 'Orders'
  );
  const primaryTitle = sheetTitles[0] || 'Orders';
  const summaryTitle = sheetTitles.find((t) => t === 'Sales Summary');

  const headerRow = [
    'เลขออเดอร์',
    'วันที่-เวลา',
    'ชื่อลูกค้า',
    'เบอร์โทร',
    'Instagram',
    'ที่อยู่จัดส่ง',
    'รายการสินค้า',
    'ยอดสินค้า (บาท)',
    'ค่าจัดส่ง (บาท)',
    'ยอดรวม (บาท)',
    'สถานะ',
    'หมายเหตุ',
  ];

  const orderRows = orders.map((o) => [
    o.order_number,
    o.created_at,
    o.customer_name,
    o.customer_phone,
    o.customer_instagram,
    o.customer_address,
    o.items.map((it) => `${it.product_name} x${it.quantity}`).join(', '),
    o.subtotal,
    o.shipping_fee === null ? 'รอยืนยัน' : o.shipping_fee,
    o.total,
    ORDER_STATUS_META[o.status]?.label || o.status,
    o.note || '-',
  ]);

  const encodedRange = encodeURIComponent(`'${primaryTitle}'!A1`);
  const updateRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodedRange}?valueInputOption=USER_ENTERED`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        values: [headerRow, ...orderRows],
      }),
    }
  );

  if (!updateRes.ok) {
    const errText = await updateRes.text();
    throw new Error(`อัปเดตข้อมูลไปยัง Google Sheets ไม่สำเร็จ (${updateRes.status}): ${errText}`);
  }

  if (summaryTitle && sales) {
    const summaryValues = [
      ["Bibi's Treats — สรุปยอดขาย", `${sales.startDate} ถึง ${sales.endDate}`],
      [],
      ['หัวข้อ', 'มูลค่า / จำนวน'],
      ['ยอดขายวันนี้ (ยืนยันแล้ว)', sales.todaySales],
      ['ยอดขาย 7 วันล่าสุด', sales.weeklySales],
      ['ยอดขายเดือนนี้', sales.monthlySales],
      ['ยอดขายรวมทั้งหมด (ยืนยันแล้ว)', sales.totalConfirmedSales],
      ['ยอดขายในช่วงที่เลือก', sales.rangeConfirmedSales],
      ['จำนวนออเดอร์ทั้งหมดในช่วง', sales.rangeOrdersCount],
      ['จำนวนสินค้าที่ขายได้ (ชิ้น)', sales.rangeItemsSold],
      [],
      ['เมนูขายดี', 'จำนวนที่ขายได้ (ชิ้น)', 'ยอดขาย (บาท)'],
      ...sales.bestSellers.map((b) => [b.product_name, b.units_sold, b.revenue]),
    ];

    const sumRange = encodeURIComponent(`'${summaryTitle}'!A1`);
    await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${sumRange}?valueInputOption=USER_ENTERED`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ values: summaryValues }),
      }
    );
  }

  return { syncedRows: orderRows.length, primarySheetTitle: primaryTitle };
}
