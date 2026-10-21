import { Component, signal, computed, OnDestroy } from '@angular/core';
import { BarcodeScanner } from './barcode-scanner';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
type Row = Record<string, any>;
@Component({
  selector: 'app-root',
  imports: [CommonModule, FormsModule, BarcodeScanner],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App implements OnDestroy {
  scanTarget = signal<'sale' | 'inventory' | 'receipt' | 'product' | null>(null);
  unknownBarcode = signal('');
  private scanIndex = 0;
  private pendingScan: {
    target: 'sale' | 'inventory' | 'receipt';
    index: number;
    code: string;
  } | null = null;
  private cashTimer: ReturnType<typeof setInterval>;
  user = signal<Row | null>(null);
  busy = signal(false);
  error = signal('');
  message = signal('');
  page = signal('Resumen');
  search = signal('');
  modal = signal('');
  data = signal<Record<string, Row[]>>({});
  cart = signal<Row[]>([]);
  ticket = signal<Row | null>(null);
  automaticCash = signal(true);
  username = '';
  password = '';
  csrf = '';
  payment = 'CASH';
  tendered = 0;
  prescription = false;
  amount = 0;
  key = '';
  product = this.emptyProduct();
  supplier = { name: '', nit: '', contact: '', leadDays: 3 };
  receipt = { supplierId: 0, document: '', lines: [this.emptyLine()] };
  nav = [
    ['◈', 'Resumen'],
    ['▦', 'Punto de venta'],
    ['✚', 'Catálogo'],
    ['▤', 'Inventario'],
    ['↙', 'Compras'],
    ['◇', 'Proveedores'],
    ['▣', 'Caja'],
    ['↗', 'Ventas'],
    ['≡', 'Auditoría'],
  ];
  total = computed(() => this.cart().reduce((s, l) => s + l['price'] * l['quantity'], 0));
  today = new Intl.DateTimeFormat('es-GT', {
    dateStyle: 'full',
    timeZone: 'America/Guatemala',
  }).format(new Date());
  dayKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Guatemala' }).format(new Date());
  constructor() {
    void this.restore();
    this.cashTimer = setInterval(() => {
      if (
        this.user() &&
        !this.busy() &&
        (this.page() === 'Caja' || this.page() === 'Punto de venta')
      ) {
        void this.request('/cash')
          .then((rows) => this.data.update((d) => ({ ...d, cash: rows })))
          .catch(() => {});
      }
    }, 15000);
  }
  rows(name: string) {
    return this.data()[name] || [];
  }
  filtered(name: string) {
    return this.rows(name).filter((p) =>
      [p['name'], p['product_name'], p['sku'], p['generic_name'], p['barcode']]
        .join(' ')
        .toLowerCase()
        .includes(this.search().toLowerCase()),
    );
  }
  low() {
    return this.rows('products').filter((p) => p['stock'] <= p['minimum_stock']);
  }
  expiring() {
    return this.rows('inventory').filter(
      (l) => l['qty_base'] > 0 && new Date(l['expires_on']).getTime() < Date.now() + 90 * 86400000,
    );
  }
  todaySales() {
    return this.rows('sales').filter(
      (s) =>
        new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Guatemala' }).format(
          new Date(s['created_at']),
        ) === this.dayKey,
    );
  }
  todayTotal() {
    return this.todaySales().reduce((s, r) => s + Number(r['total']), 0);
  }
  activeCash() {
    return this.rows('cash').find((c) => !c['closed_at']);
  }
  has(roles: string[]) {
    return roles.includes(this.user()?.['role']);
  }
  canWrite() {
    return this.has(['ADMIN', 'SUPERVISOR']);
  }
  canReceive() {
    return this.has(['ADMIN', 'SUPERVISOR', 'INVENTORY']);
  }
  canSell() {
    return this.has(['ADMIN', 'SUPERVISOR', 'CASHIER']);
  }
  visibleNav() {
    return this.nav.filter(
      (n) =>
        !(n[1] === 'Auditoría' && !this.has(['ADMIN', 'SUPERVISOR', 'ACCOUNTANT'])) &&
        !(['Punto de venta', 'Caja'].includes(n[1]) && !this.canSell()) &&
        !(
          ['Compras', 'Proveedores'].includes(n[1]) &&
          !this.canReceive() &&
          !this.has(['ACCOUNTANT'])
        ),
    );
  }
  emptyProduct() {
    return {
      sku: '',
      name: '',
      genericName: '',
      baseUnit: 'tableta',
      category: 'Medicamentos',
      requiresRx: false,
      controlled: false,
      fractional: false,
      minimumStock: 10,
      presentations: [{ name: 'Caja', factor: 20, price: 0, barcode: '', fractional: false }],
    };
  }
  emptyLine() {
    return { presentationId: 0, quantity: 1, lot: '', expiresOn: '', totalCost: 0 };
  }
  async request(path: string, body?: unknown, extra: Record<string, string> = {}) {
    const r = await fetch('/api/v1' + path, {
      method: body === undefined ? 'GET' : 'POST',
      credentials: 'same-origin',
      headers: {
        ...(body === undefined
          ? {}
          : { 'Content-Type': 'application/json', 'X-XSRF-TOKEN': this.csrf }),
        ...extra,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!r.ok) {
      if (r.status === 401) {
        this.user.set(null);
        this.scanTarget.set(null);
        this.unknownBarcode.set('');
        this.pendingScan = null;
      }
      let message = [502, 503, 504].includes(r.status)
        ? 'El servicio de la farmacia no está disponible. Intenta de nuevo en unos momentos.'
        : 'No se pudo completar la operación (' + r.status + ').';
      try {
        message = (await r.json()).message || message;
      } catch {}
      throw Object.assign(new Error(message), { status: r.status });
    }
    return r.status === 204 ? null : r.json();
  }
  async run(fn: () => Promise<void>) {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    this.message.set('');
    try {
      await fn();
    } catch (e) {
      this.error.set((e as Error).message);
    } finally {
      this.busy.set(false);
    }
  }
  async restore() {
    try {
      this.csrf = (await this.request('/auth/csrf')).token;
      this.user.set(await this.request('/auth/me'));
      await this.refresh();
    } catch (error) {
      if ((error as { status?: number }).status !== 401) {
        this.error.set(
          (error as { status?: number }).status
            ? (error as Error).message
            : 'No se pudo conectar con el servidor. Revisa tu conexión e intenta de nuevo.',
        );
      }
    }
  }
  async login() {
    await this.run(async () => {
      this.csrf = (await this.request('/auth/csrf')).token;
      const r = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-XSRF-TOKEN': this.csrf },
        body: new URLSearchParams({ username: this.username, password: this.password }),
      });
      if (!r.ok) throw new Error('Usuario o contraseña incorrectos.');
      this.password = '';
      this.csrf = (await this.request('/auth/csrf')).token;
      this.user.set(await this.request('/auth/me'));
      await this.refresh();
    });
  }
  async logout() {
    await this.run(async () => {
      await this.request('/auth/logout', {});
      this.user.set(null);
      this.data.set({});
      this.cart.set([]);
      this.ticket.set(null);
      this.scanTarget.set(null);
      this.unknownBarcode.set('');
      this.pendingScan = null;
    });
  }
  async refresh() {
    this.automaticCash.set((await this.request('/cash/schedule')).automatic);
    const names = ['products', 'presentations', 'suppliers', 'inventory'];
    if (this.canReceive() || this.has(['ACCOUNTANT'])) names.push('receipts', 'movements');
    if (this.canSell() || this.has(['ACCOUNTANT'])) names.push('sales', 'cash');
    if (this.has(['ADMIN', 'SUPERVISOR', 'ACCOUNTANT'])) names.push('audit');
    const results = await Promise.all(names.map((n) => this.request('/' + n)));
    this.data.set(Object.fromEntries(names.map((n, i) => [n, results[i]])));
  }
  async reload() {
    await this.run(async () => this.refresh());
  }
  go(p: string) {
    this.page.set(p);
    this.search.set('');
    this.error.set('');
    this.message.set('');
  }
  money(v: unknown) {
    return new Intl.NumberFormat('es-GT', { style: 'currency', currency: 'GTQ' }).format(
      Number(v || 0),
    );
  }
  date(v: unknown) {
    return v
      ? new Intl.DateTimeFormat('es-GT', {
          dateStyle: 'medium',
          timeZone: 'America/Guatemala',
        }).format(
          new Date(/^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? String(v) + 'T12:00:00Z' : String(v)),
        )
      : '—';
  }
  stock(id: number) {
    return this.rows('products').find((p) => p['id'] === id)?.['stock'] || 0;
  }
  add(p: Row) {
    this.key = '';
    this.cart.update((c) =>
      c.some((l) => l['id'] === p['id'])
        ? c.map((l) => (l['id'] === p['id'] ? { ...l, quantity: l['quantity'] + 1 } : l))
        : [...c, { ...p, quantity: 1 }],
    );
    this.tendered = this.total();
  }
  quantity(id: number, delta: number) {
    this.key = '';
    this.cart.update((c) =>
      c
        .map((l) => (l['id'] === id ? { ...l, quantity: l['quantity'] + delta } : l))
        .filter((l) => l['quantity'] > 0),
    );
    this.tendered = this.total();
  }
  async saveProduct() {
    await this.run(async () => {
      const created = await this.request('/products', this.product);
      this.modal.set('');
      this.product = this.emptyProduct();
      await this.refresh();
      this.message.set('Producto registrado.');
      if (this.pendingScan) {
        const pending = this.pendingScan;
        this.pendingScan = null;
        const presentation = this.rows('presentations').find(
          (p) => p['product_id'] === created.id && p['barcode'] === pending.code,
        );
        if (presentation) {
          this.selectReceiptPresentation(
            presentation,
            pending.target === 'receipt' ? pending.index : 0,
          );
          this.message.set(
            'Producto registrado. Completa lote, vencimiento y costo para ingresar existencias antes de vender.',
          );
        }
      }
    });
  }
  async saveSupplier() {
    await this.run(async () => {
      await this.request('/suppliers', this.supplier);
      this.modal.set('');
      this.supplier = { name: '', nit: '', contact: '', leadDays: 3 };
      await this.refresh();
      this.message.set('Proveedor registrado.');
    });
  }
  async saveReceipt() {
    await this.run(async () => {
      await this.request('/receipts', this.receipt);
      this.modal.set('');
      this.receipt = { supplierId: 0, document: '', lines: [this.emptyLine()] };
      await this.refresh();
      this.message.set('Recepción confirmada. Inventario actualizado en unidades base.');
    });
  }
  async checkout() {
    await this.run(async () => {
      if (!this.key) this.key = crypto.randomUUID();
      const r = await this.request(
        '/sales/checkout',
        {
          lines: this.cart().map((l) => ({
            presentationId: l['id'],
            quantity: l['quantity'],
            expectedPrice: l['price'],
          })),
          method: this.payment,
          tendered: this.tendered,
          prescriptionChecked: this.prescription,
        },
        { 'Idempotency-Key': this.key },
      );
      this.ticket.set(await this.request('/sales/' + r.id));
      this.cart.set([]);
      this.key = '';
      this.prescription = false;
      await this.refresh();
      this.message.set('Venta #' + r.id + ' registrada. Cambio: ' + this.money(r.change_amount));
    });
  }
  async cashAction() {
    await this.run(async () => {
      const closing = !!this.activeCash();
      const r = await this.request(closing ? '/cash/close' : '/cash/open', { amount: this.amount });
      await this.refresh();
      this.message.set(
        closing ? 'Caja cerrada. Diferencia: ' + this.money(r.difference) : 'Caja abierta.',
      );
    });
  }
  async showTicket(id: number) {
    await this.run(async () => {
      this.ticket.set(await this.request('/sales/' + id));
    });
  }
  print() {
    window.print();
  }

  openScanner(target: 'sale' | 'inventory' | 'receipt' | 'product', index = 0) {
    if (
      (target === 'sale' && !this.canSell()) ||
      (['inventory', 'receipt'].includes(target) && !this.canReceive()) ||
      (target === 'product' && !this.canWrite())
    )
      return;
    this.scanIndex = index;
    this.unknownBarcode.set('');
    this.error.set('');
    this.scanTarget.set(target);
  }

  handleBarcode(code: string) {
    const target = this.scanTarget();
    this.scanTarget.set(null);
    if (!target) return;
    const presentation = this.rows('presentations').find((p) => p['barcode'] === code);
    if (target === 'product') {
      if (presentation) {
        this.error.set(
          'Ese código ya pertenece a ' +
            presentation['product_name'] +
            ' · ' +
            presentation['name'] +
            '. Para agregar existencias utiliza Recibir compra.',
        );
        return;
      }
      const draft = this.product.presentations[this.scanIndex];
      if (draft) draft.barcode = code;
      return;
    }
    if (presentation) {
      this.pendingScan = null;
      if (target === 'sale') {
        if (presentation['controlled']) {
          this.error.set('La venta de productos controlados no está habilitada.');
          return;
        }
        if (presentation['sale_enabled'] === false) {
          this.error.set('Esta presentación no está habilitada para venta.');
          return;
        }
        this.add(presentation);
        this.message.set(
          'Agregado: ' + presentation['product_name'] + ' · ' + presentation['name'],
        );
      } else
        this.selectReceiptPresentation(presentation, target === 'receipt' ? this.scanIndex : 0);
      return;
    }
    this.pendingScan = { target, index: this.scanIndex, code };
    this.unknownBarcode.set(code);
  }

  registerScannedProduct() {
    if (!this.canWrite() || !this.pendingScan) return;
    this.product = this.emptyProduct();
    this.product.presentations[0].barcode = this.pendingScan.code;
    this.unknownBarcode.set('');
    this.modal.set('product');
  }

  private selectReceiptPresentation(presentation: Row, index: number) {
    if (!this.canReceive()) return;
    if (!this.receipt.lines[index]) this.receipt.lines[index] = this.emptyLine();
    if (
      this.receipt.lines[index].presentationId &&
      this.receipt.lines[index].presentationId !== presentation['id']
    ) {
      index = this.receipt.lines.length;
      this.receipt.lines.push(this.emptyLine());
    }
    this.receipt.lines[index].presentationId = presentation['id'];
    this.modal.set('receipt');
    this.message.set(
      'Presentación seleccionada. Completa proveedor, lote, vencimiento, cantidad y costo.',
    );
  }

  dismissUnknownBarcode() {
    this.unknownBarcode.set('');
    this.pendingScan = null;
  }
  ngOnDestroy() {
    clearInterval(this.cashTimer);
  }
}
