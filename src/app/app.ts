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
  total = computed(() =>
    this.cents(this.cart().reduce((s, l) => s + l['price'] * l['quantity'], 0)),
  );
  // El punto de venta muestra como máximo estas tarjetas; con catálogos grandes se refina buscando.
  readonly posLimit = 60;
  private stockByProduct = computed(
    () => new Map(this.rows('products').map((p) => [p['id'], Number(p['stock']) || 0])),
  );
  private cartBase = computed(() => {
    const used = new Map<number, number>();
    for (const l of this.cart())
      used.set(l['product_id'], (used.get(l['product_id']) || 0) + l['quantity'] * l['factor']);
    return used;
  });
  posMatches = computed(() => {
    const term = this.search().trim().toLowerCase();
    return this.rows('presentations').filter(
      (p) =>
        p['sale_enabled'] !== false &&
        (!term ||
          [p['product_name'], p['generic_name'], p['name'], p['sku'], p['barcode']]
            .join(' ')
            .toLowerCase()
            .includes(term)),
    );
  });
  posResults = computed(() => this.posMatches().slice(0, this.posLimit));
  needsRx = computed(() => this.cart().some((l) => l['requires_rx']));
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
  // Sin `only` recarga todo; con `only` recarga solo esas colecciones (las permitidas al rol).
  async refresh(only?: string[]) {
    if (!only) this.automaticCash.set((await this.request('/cash/schedule')).automatic);
    const names = ['products', 'presentations', 'suppliers', 'inventory'];
    if (this.canReceive() || this.has(['ACCOUNTANT'])) names.push('receipts', 'movements');
    if (this.canSell() || this.has(['ACCOUNTANT'])) names.push('sales', 'cash');
    if (this.has(['ADMIN', 'SUPERVISOR', 'ACCOUNTANT'])) names.push('audit');
    const load = only ? names.filter((n) => only.includes(n)) : names;
    const results = await Promise.all(load.map((n) => this.request('/' + n)));
    const fresh = Object.fromEntries(load.map((n, i) => [n, results[i]]));
    this.data.update((d) => (only ? { ...d, ...fresh } : fresh));
    this.syncCart();
  }
  // Ajusta el carrito a los precios vigentes y retira presentaciones que ya no se venden.
  private syncCart() {
    const current = new Map(this.rows('presentations').map((p) => [p['id'], p]));
    let changed = false;
    const lines = this.cart().flatMap((l) => {
      const p = current.get(l['id']);
      if (!p || p['sale_enabled'] === false || p['controlled']) {
        changed = true;
        return [];
      }
      if (Number(p['price']) === Number(l['price'])) return [l];
      changed = true;
      return [{ ...l, price: p['price'] }];
    });
    if (!changed) return;
    this.cart.set(lines);
    this.key = '';
    this.tendered = this.total();
    this.message.set('El carrito se actualizó con los precios y productos vigentes. Revísalo.');
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
  cents(v: number) {
    return Math.round(v * 100) / 100;
  }
  stock(id: number) {
    return this.stockByProduct().get(id) || 0;
  }
  // Unidades adicionales de esta presentación que caben en la existencia vendible del producto.
  remaining(p: Row) {
    const stock = this.stockByProduct().get(p['product_id']);
    if (stock === undefined) return Infinity; // sin dato de existencia: decide el servidor
    return Math.floor((stock - (this.cartBase().get(p['product_id']) || 0)) / p['factor']);
  }
  add(p: Row) {
    if (this.remaining(p) < 1) {
      this.error.set(
        'Sin existencias suficientes de ' + p['product_name'] + ' · ' + p['name'] + '.',
      );
      return false;
    }
    this.key = '';
    this.cart.update((c) =>
      c.some((l) => l['id'] === p['id'])
        ? c.map((l) => (l['id'] === p['id'] ? { ...l, quantity: l['quantity'] + 1 } : l))
        : [...c, { ...p, quantity: 1 }],
    );
    this.tendered = this.total();
    return true;
  }
  quantity(id: number, delta: number) {
    const line = this.cart().find((l) => l['id'] === id);
    if (line && delta > 0 && this.remaining(line) < delta) {
      this.error.set(
        'No hay más existencias de ' + line['product_name'] + ' · ' + line['name'] + '.',
      );
      return;
    }
    this.key = '';
    this.cart.update((c) =>
      c
        .map((l) => (l['id'] === id ? { ...l, quantity: l['quantity'] + delta } : l))
        .filter((l) => l['quantity'] > 0),
    );
    this.tendered = this.total();
  }
  remove(id: number) {
    this.key = '';
    this.cart.update((c) => c.filter((l) => l['id'] !== id));
    this.tendered = this.total();
  }
  clearCart() {
    this.key = '';
    this.cart.set([]);
    this.tendered = 0;
    this.prescription = false;
  }
  setPayment(method: string) {
    this.payment = method;
    this.tendered = this.total();
  }
  // Efectivo: importe exacto y los siguientes billetes redondos que el cliente suele entregar.
  cashOptions() {
    const t = this.total();
    if (!t) return [];
    return [...new Set([t, ...[10, 50, 100, 200].map((b) => Math.ceil(t / b) * b)])]
      .sort((a, b) => a - b)
      .slice(0, 4);
  }
  missing() {
    return this.payment === 'CASH'
      ? Math.max(0, this.cents(this.total() - (this.tendered || 0)))
      : 0;
  }
  change() {
    return this.payment === 'CASH'
      ? Math.max(0, this.cents((this.tendered || 0) - this.total()))
      : 0;
  }
  canCheckout() {
    return (
      !this.busy() &&
      this.cart().length > 0 &&
      !!this.activeCash() &&
      (!this.needsRx() || this.prescription) &&
      this.missing() === 0
    );
  }
  // Enter en el buscador: un lector USB escribe el código y pulsa Enter.
  searchEnter() {
    const term = this.search().trim();
    if (!term || !this.canSell()) return;
    const matches = this.posMatches();
    if (this.rows('presentations').some((p) => p['barcode'] === term) || /^\d{8,14}$/.test(term)) {
      this.search.set('');
      this.applyCode('sale', term);
    } else if (matches.length === 1) {
      this.search.set('');
      this.sell(matches[0]);
    }
  }
  private sell(presentation: Row) {
    if (presentation['controlled']) {
      this.error.set('La venta de productos controlados no está habilitada.');
      return;
    }
    if (presentation['sale_enabled'] === false) {
      this.error.set('Esta presentación no está habilitada para venta.');
      return;
    }
    this.error.set('');
    if (this.add(presentation))
      this.message.set('Agregado: ' + presentation['product_name'] + ' · ' + presentation['name']);
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
      let r;
      try {
        r = await this.request(
          '/sales/checkout',
          {
            lines: this.cart().map((l) => ({
              presentationId: l['id'],
              quantity: l['quantity'],
              expectedPrice: l['price'],
            })),
            method: this.payment,
            tendered: this.payment === 'CASH' ? this.tendered : this.total(),
            prescriptionChecked: this.prescription,
          },
          { 'Idempotency-Key': this.key },
        );
      } catch (e) {
        // 409: cambió un precio o la existencia; se recargan para corregir el carrito.
        if ((e as { status?: number }).status === 409)
          await this.refresh(['products', 'presentations', 'inventory']).catch(() => {});
        throw e;
      }
      this.ticket.set(await this.request('/sales/' + r.id));
      this.cart.set([]);
      this.key = '';
      this.prescription = false;
      this.tendered = 0;
      await this.refresh(['products', 'inventory', 'movements', 'sales', 'cash', 'audit']);
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
    if (target) this.applyCode(target, code);
  }

  private applyCode(target: 'sale' | 'inventory' | 'receipt' | 'product', code: string) {
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
      if (target === 'sale') this.sell(presentation);
      else this.selectReceiptPresentation(presentation, target === 'receipt' ? this.scanIndex : 0);
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
