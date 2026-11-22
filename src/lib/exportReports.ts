import writeXlsxFile from 'write-excel-file/browser';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { ORDER_STATUS_META, type SalesReportData } from '../types';

export async function exportSalesToExcel(report: SalesReportData) {
  const summarySheet = [
    [{ value: "Bibi's Treats — รายงานสรุปยอดขาย", fontWeight: 'bold' as const }],
    [{ value: 'ช่วงวันที่' }, { value: `${report.startDate} ถึง ${report.endDate}` }],
    [],
    [
      { value: 'รายการสรุป', fontWeight: 'bold' as const },
      { value: 'จำนวน / ยอดเงิน (บาท)', fontWeight: 'bold' as const },
    ],
    [{ value: 'ยอดขายวันนี้ (ยืนยันแล้ว)' }, { type: Number, value: report.todaySales }],
    [{ value: 'ยอดขายรายสัปดาห์ (7 วันล่าสุด)' }, { type: Number, value: report.weeklySales }],
    [{ value: 'ยอดขายรายเดือน' }, { type: Number, value: report.monthlySales }],
    [{ value: 'ยอดขายรวมทั้งหมด (ยืนยันแล้ว)' }, { type: Number, value: report.totalConfirmedSales }],
    [{ value: 'ยอดขายจริงในช่วงที่เลือก' }, { type: Number, value: report.rangeConfirmedSales }],
    [{ value: 'ยอดออเดอร์รอยืนยันในช่วงที่เลือก' }, { type: Number, value: report.rangePendingSales }],
    [{ value: 'ยอดออเดอร์ยกเลิกในช่วงที่เลือก' }, { type: Number, value: report.rangeCancelledSales }],
    [{ value: 'จำนวนออเดอร์ทั้งหมดในช่วงที่เลือก' }, { type: Number, value: report.rangeOrdersCount }],
    [{ value: 'จำนวนสินค้าที่ขายได้ (ชิ้น)' }, { type: Number, value: report.rangeItemsSold }],
  ];

  const bestSellersSheet = [
    [
      { value: 'อันดับ', fontWeight: 'bold' as const },
      { value: 'ชื่อเมนู', fontWeight: 'bold' as const },
      { value: 'จำนวนที่ขายได้ (ชิ้น)', fontWeight: 'bold' as const },
      { value: 'ยอดขายรวม (บาท)', fontWeight: 'bold' as const },
    ],
    ...report.bestSellers.map((b, i) => [
      { type: Number, value: i + 1 },
      { type: String, value: b.product_name },
      { type: Number, value: b.units_sold },
      { type: Number, value: b.revenue },
    ]),
  ];

  const ordersSheet = [
    [
      { value: 'เลขออเดอร์', fontWeight: 'bold' as const },
      { value: 'วันที่-เวลา', fontWeight: 'bold' as const },
      { value: 'ชื่อลูกค้า', fontWeight: 'bold' as const },
      { value: 'เบอร์โทรศัพท์', fontWeight: 'bold' as const },
      { value: 'Instagram', fontWeight: 'bold' as const },
      { value: 'ที่อยู่จัดส่ง', fontWeight: 'bold' as const },
      { value: 'รายการขนม', fontWeight: 'bold' as const },
      { value: 'ยอดสินค้า', fontWeight: 'bold' as const },
      { value: 'ค่าจัดส่ง', fontWeight: 'bold' as const },
      { value: 'ยอดรวม', fontWeight: 'bold' as const },
      { value: 'สถานะ', fontWeight: 'bold' as const },
    ],
    ...report.orders.map((o) => [
      { type: String, value: o.order_number },
      { type: String, value: o.created_at },
      { type: String, value: o.customer_name },
      { type: String, value: o.customer_phone },
      { type: String, value: o.customer_instagram },
      { type: String, value: o.customer_address },
      {
        type: String,
        value: o.items.map((it) => `${it.product_name} x${it.quantity}`).join(', '),
      },
      { type: Number, value: o.subtotal },
      o.shipping_fee === null
        ? { type: String, value: 'รอยืนยัน' }
        : { type: Number, value: o.shipping_fee },
      { type: Number, value: o.total },
      { type: String, value: ORDER_STATUS_META[o.status]?.label || o.status },
    ]),
  ];

  await writeXlsxFile([
    {
      sheet: 'Summary',
      data: summarySheet,
      columns: [{ width: 36 }, { width: 22 }],
    },
    {
      sheet: 'Best Sellers',
      data: bestSellersSheet,
      columns: [{ width: 10 }, { width: 34 }, { width: 22 }, { width: 20 }],
    },
    {
      sheet: 'Orders',
      data: ordersSheet,
      columns: [
        { width: 14 },
        { width: 20 },
        { width: 22 },
        { width: 15 },
        { width: 18 },
        { width: 38 },
        { width: 36 },
        { width: 12 },
        { width: 12 },
        { width: 12 },
        { width: 16 },
      ],
    },
  ]).toFile(`bibis-treats-sales-${report.startDate}-to-${report.endDate}.xlsx`);
}

export function exportSalesToPdf(report: SalesReportData) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });

  doc.setFillColor(225, 241, 255);
  doc.rect(0, 0, 595, 86, 'F');

  doc.setTextColor(28, 53, 84);
  doc.setFontSize(20);
  doc.text("Bibi's Treats - Sales Report", 40, 42);

  doc.setFontSize(10);
  doc.setTextColor(86, 115, 148);
  doc.text(`Sweet treats, happy hearts | Period: ${report.startDate} to ${report.endDate}`, 40, 62);

  autoTable(doc, {
    startY: 106,
    head: [['Metric', 'Value (THB / Count)']],
    body: [
      ['Today Confirmed Sales', `${report.todaySales.toLocaleString()} THB`],
      ['Last 7 Days Confirmed Sales', `${report.weeklySales.toLocaleString()} THB`],
      ['This Month Confirmed Sales', `${report.monthlySales.toLocaleString()} THB`],
      ['Total Confirmed Sales (All Time)', `${report.totalConfirmedSales.toLocaleString()} THB`],
      ['Selected Range Confirmed Revenue', `${report.rangeConfirmedSales.toLocaleString()} THB`],
      ['Selected Range Pending Orders Value', `${report.rangePendingSales.toLocaleString()} THB`],
      ['Selected Range Cancelled Value', `${report.rangeCancelledSales.toLocaleString()} THB`],
      [
        'Total Orders in Range',
        `${report.rangeOrdersCount} orders (${report.rangeConfirmedOrdersCount} confirmed)`,
      ],
      ['Total Items Sold (Confirmed)', `${report.rangeItemsSold} pcs`],
    ],
    theme: 'grid',
    headStyles: { fillColor: [59, 137, 204], textColor: 255 },
    styles: { fontSize: 9.5, cellPadding: 6 },
  });

  const afterKpiY = (doc as any).lastAutoTable?.finalY || 320;

  doc.setFontSize(12);
  doc.setTextColor(28, 53, 84);
  doc.text('Best Selling Menu', 40, afterKpiY + 26);

  autoTable(doc, {
    startY: afterKpiY + 34,
    head: [['#', 'Menu Item', 'Units Sold', 'Revenue (THB)']],
    body:
      report.bestSellers.length > 0
        ? report.bestSellers.map((b, idx) => [
            String(idx + 1),
            b.product_name,
            String(b.units_sold),
            b.revenue.toLocaleString(),
          ])
        : [['-', 'No confirmed sales in selected period', '0', '0']],
    theme: 'striped',
    headStyles: { fillColor: [92, 169, 230], textColor: 255 },
    styles: { fontSize: 9.5, cellPadding: 6 },
  });

  const afterBestY = (doc as any).lastAutoTable?.finalY || 480;

  doc.setFontSize(12);
  doc.setTextColor(28, 53, 84);
  doc.text('Order Breakdown by Status', 40, afterBestY + 26);

  const englishStatusLabels: Record<string, string> = {
    pending: 'Pending Confirmation',
    confirmed: 'Confirmed',
    preparing: 'Preparing',
    delivering: 'Out for Delivery',
    completed: 'Completed',
    cancelled: 'Cancelled',
  };

  autoTable(doc, {
    startY: afterBestY + 34,
    head: [['Status', 'Orders', 'Amount (THB)']],
    body: report.byStatus.map((s) => [
      englishStatusLabels[s.status] || s.status,
      String(s.count),
      s.revenue.toLocaleString(),
    ]),
    theme: 'grid',
    headStyles: { fillColor: [59, 137, 204], textColor: 255 },
    styles: { fontSize: 9.5, cellPadding: 6 },
  });

  doc.save(`bibis-treats-sales-${report.startDate}-to-${report.endDate}.pdf`);
}
