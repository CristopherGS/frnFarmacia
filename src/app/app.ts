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
  private accessTimer: ReturnType<typeof setInterval>;
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
    ['☺', 'Usuarios'],
    ['⚙', 'Configuración'],
  ];
  // Permisos que dan acceso a cada página; Resumen es para todos y Usuarios solo para el administrador.
  private navNeeds: Record<string, string[]> = {
    'Punto de venta': ['POS_SELL'],
    Catálogo: ['CATALOG_VIEW', 'CATALOG_MANAGE'],
    Inventario: ['INVENTORY_VIEW'],
    Compras: ['PURCHASES_VIEW', 'PURCHASES_RECEIVE'],
    Proveedores: ['SUPPLIERS_VIEW', 'SUPPLIERS_MANAGE'],
    Caja: ['CASH_VIEW', 'CASH_MANAGE'],
    Ventas: ['SALES_VIEW'],
    Auditoría: ['AUDIT_VIEW'],
  };
  roleNames: Record<string, string> = {
    ADMIN: 'Administrador',
    SUPERVISOR: 'Supervisor',
    CASHIER: 'Cajero',
    INVENTORY: 'Inventario',
    ACCOUNTANT: 'Contador',
  };
  roleKeys = Object.keys(this.roleNames);
  perms = computed(() => new Set<string>(this.user()?.['permissions'] ?? []));
  brand = signal({ name: 'SG Farma', noun: 'farmacia', type: 'FARMACIA', color: '#1c765b' });
  brandHead = computed(() => this.brand().name.trim().split(/\s+/).slice(0, -1).join(' '));
  brandTail = computed(() => this.brand().name.trim().split(/\s+/).at(-1) ?? '');
  modules = computed(() => new Set<string>(this.user()?.['modules'] ?? []));
  rxOn = computed(() => this.modules().has('RX'));
  settings = signal<Row | null>(null);
  settingsForm = this.emptySettingsForm();
  keys = signal<Row[]>([]);
  keyForm = { label: '', permissions: [] as string[] };
  newSecret = signal('');
  createdKey = signal('');
  webhookResult = signal('');
  isAdmin = computed(() => this.user()?.['role'] === 'ADMIN');
  users = signal<Row[]>([]);
  access = signal<{
    permissions: { key: string; group: string; label: string }[];
    roles: Record<string, string[]>;
    implies: Record<string, string[]>;
  } | null>(null);
  permissionGroups = computed(() => {
    const groups = new Map<string, { key: string; label: string }[]>();
    for (const p of this.access()?.permissions ?? [])
      groups.set(p.group, [...(groups.get(p.group) ?? []), p]);
    return [...groups].map(([name, items]) => ({ name, items }));
  });
  editingUser = signal<Row | null>(null);
  userForm = this.emptyUserForm();
  newPassword = '';
  ownPassword = '';
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
  needsRx = computed(() => this.rxOn() && this.cart().some((l) => l['requires_rx']));
  today = new Intl.DateTimeFormat('es-GT', {
    dateStyle: 'full',
    timeZone: 'America/Guatemala',
  }).format(new Date());
  dayKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Guatemala' }).format(new Date());
  constructor() {
    void this.loadBrand();
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
    // Si el administrador cambia permisos o desactiva la cuenta, la pantalla lo refleja sin recargar.
    this.accessTimer = setInterval(() => void this.syncAccess(), 30000);
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
  // /auth/me ya entrega los permisos vigentes (el administrador tiene todos, menos los de módulos
  // apagados), así que un solo criterio sirve para todos.
  can(...keys: string[]) {
    return keys.some((k) => this.perms().has(k));
  }
  canWrite() {
    return this.can('CATALOG_MANAGE');
  }
  canReceive() {
    return this.can('PURCHASES_RECEIVE');
  }
  canSell() {
    return this.can('POS_SELL');
  }
  visibleNav() {
    return this.nav.filter((n) =>
      n[1] === 'Usuarios' || n[1] === 'Configuración'
        ? this.isAdmin()
        : !this.navNeeds[n[1]] || this.can(...this.navNeeds[n[1]]),
    );
  }
  loaded(name: string) {
    return name in this.data();
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
  async request(
    path: string,
    body?: unknown,
    extra: Record<string, string> = {},
    method = body === undefined ? 'GET' : 'POST',
  ) {
    const r = await fetch('/api/v1' + path, {
      method,
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
        ? 'El servicio no está disponible. Intenta de nuevo en unos momentos.'
        : r.status === 403
          ? 'No tienes permiso para esta acción. Pide acceso al administrador.'
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
  // Si se entra a una página mientras otra carga (por ejemplo justo después de iniciar sesión),
  // espera su turno en lugar de ignorar el clic.
  private async whenIdle(fn: () => Promise<void>) {
    for (let i = 0; i < 40 && this.busy(); i++) await new Promise((r) => setTimeout(r, 250));
    await this.run(fn);
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
    // Solo se piden las colecciones que el administrador permitió; el servidor lo exige también.
    const names: string[] = [];
    if (
      this.can('CATALOG_VIEW', 'CATALOG_MANAGE', 'POS_SELL', 'INVENTORY_VIEW', 'PURCHASES_RECEIVE')
    )
      names.push('products', 'presentations');
    if (this.can('SUPPLIERS_VIEW', 'PURCHASES_RECEIVE')) names.push('suppliers');
    if (this.can('INVENTORY_VIEW')) names.push('inventory', 'movements');
    if (this.can('PURCHASES_VIEW')) names.push('receipts');
    if (this.can('SALES_VIEW')) names.push('sales');
    if (this.can('CASH_VIEW', 'CASH_MANAGE', 'POS_SELL')) names.push('cash');
    if (this.can('AUDIT_VIEW')) names.push('audit');
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
    if (!this.visibleNav().some((n) => n[1] === p)) return;
    this.page.set(p);
    this.search.set('');
    this.error.set('');
    this.message.set('');
    if (p === 'Usuarios') void this.whenIdle(() => this.loadUsers());
    if (p === 'Configuración') void this.whenIdle(() => this.loadSettings());
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
  emptyUserForm() {
    return {
      username: '',
      password: '',
      role: 'CASHIER',
      permissions: [] as string[],
      active: true,
    };
  }
  async loadUsers() {
    const [users, access] = await Promise.all([
      this.request('/users'),
      this.access() ?? this.request('/users/permissions'),
    ]);
    this.users.set(users);
    this.access.set(access);
  }
  // Rol = plantilla inicial; el administrador puede ajustar cada permiso después.
  openUser(u?: Row) {
    this.error.set('');
    this.message.set('');
    this.newPassword = '';
    this.editingUser.set(u ?? null);
    this.userForm = u
      ? {
          username: u['username'],
          password: '',
          role: u['role'],
          permissions: [...u['permissions']],
          active: u['active'],
        }
      : { ...this.emptyUserForm(), permissions: [...(this.access()?.roles['CASHIER'] ?? [])] };
    this.modal.set('user');
  }
  editingSelf() {
    return this.editingUser()?.['username'] === this.user()?.['username'];
  }
  applyRole(role: string) {
    this.userForm.role = role;
    this.userForm.permissions = [...(this.access()?.roles[role] ?? [])];
  }
  granted(key: string) {
    return this.userForm.role === 'ADMIN' || this.userForm.permissions.includes(key);
  }
  // Dar un permiso da también los que necesita; quitarlo quita los que dependen de él.
  private withPermission(list: string[], key: string, on: boolean) {
    const implies = this.access()?.implies ?? {};
    const set = new Set(list);
    if (on) {
      set.add(key);
      (implies[key] ?? []).forEach((k) => set.add(k));
    } else {
      set.delete(key);
      for (const [k, needs] of Object.entries(implies)) if (needs.includes(key)) set.delete(k);
    }
    return [...set];
  }
  togglePermission(key: string, on: boolean) {
    this.userForm.permissions = this.withPermission(this.userForm.permissions, key, on);
  }
  toggleKeyPermission(key: string, on: boolean) {
    this.keyForm.permissions = this.withPermission(this.keyForm.permissions, key, on);
  }
  permissionSummary(u: Row) {
    return u['role'] === 'ADMIN'
      ? 'Acceso total'
      : u['permissions'].length + ' de ' + (this.access()?.permissions.length ?? '—') + ' permisos';
  }
  async saveUser() {
    await this.run(async () => {
      const editing = this.editingUser();
      const f = this.userForm;
      if (editing)
        await this.request(
          '/users/' + editing['id'],
          { role: f.role, permissions: f.permissions, active: f.active },
          {},
          'PUT',
        );
      else
        await this.request('/users', {
          username: f.username,
          password: f.password,
          role: f.role,
          permissions: f.permissions,
        });
      this.modal.set('');
      await this.loadUsers();
      this.message.set(editing ? 'Cambios guardados. Aplican de inmediato.' : 'Usuario creado.');
    });
  }
  async resetUserPassword() {
    await this.run(async () => {
      await this.request('/users/' + this.editingUser()!['id'] + '/password', {
        password: this.newPassword,
      });
      this.newPassword = '';
      this.message.set('Contraseña restablecida.');
    });
  }
  async changeOwnPassword() {
    await this.run(async () => {
      await this.request('/users/password', { password: this.ownPassword });
      this.ownPassword = '';
      this.modal.set('');
      this.message.set('Tu contraseña se actualizó.');
    });
  }
  // Recoge cambios de permisos o de estado hechos por el administrador mientras hay sesión abierta.
  async syncAccess() {
    if (!this.user() || this.busy()) return;
    try {
      const me = await this.request('/auth/me');
      const snapshot = (u: Row) => JSON.stringify([u['role'], u['permissions'], u['modules']]);
      if (snapshot(me) === snapshot(this.user()!)) return;
      this.user.set(me);
      if (!this.visibleNav().some((n) => n[1] === this.page())) this.page.set('Resumen');
      await this.refresh();
    } catch {}
  }
  emptySettingsForm() {
    return {
      name: '',
      type: 'FARMACIA',
      color: '#1c765b',
      modules: [] as string[],
      webhookUrl: '',
    };
  }
  // Nombre y color del negocio: se leen sin iniciar sesión para la pantalla de acceso.
  async loadBrand() {
    try {
      const brand = await this.request('/settings/public');
      this.brand.set(brand);
      document.title = brand.name + ' · Control interno';
      document.documentElement.style.setProperty('--brand', brand.color);
    } catch {}
  }
  async loadSettings() {
    const [settings, keys, access] = await Promise.all([
      this.request('/settings'),
      this.request('/integrations/keys'),
      this.access() ?? this.request('/users/permissions'),
    ]);
    this.settings.set(settings);
    this.keys.set(keys);
    this.access.set(access);
    this.settingsForm = {
      name: settings['name'],
      type: settings['type'],
      color: settings['color'],
      modules: [...settings['modules']],
      webhookUrl: settings['webhookUrl'],
    };
  }
  // Cada tipo de negocio trae su plantilla de módulos; después se ajusta uno por uno.
  applyBusinessType(type: string) {
    const template = (this.settings()?.['types'] ?? []).find((t: Row) => t['key'] === type);
    this.settingsForm.type = type;
    this.settingsForm.modules = [...(template?.['modules'] ?? [])];
  }
  toggleModule(key: string, on: boolean) {
    const set = new Set(this.settingsForm.modules);
    if (on) set.add(key);
    else set.delete(key);
    this.settingsForm.modules = [...set];
  }
  async saveSettings() {
    await this.run(async () => {
      await this.request('/settings', this.settingsForm, {}, 'PUT');
      await this.loadBrand();
      await this.loadSettings();
      // Los módulos cambian lo que se ve en todo el menú: se recarga el acceso de esta sesión.
      this.user.set(await this.request('/auth/me'));
      await this.refresh();
      this.message.set('Configuración guardada.');
    });
  }
  async newWebhookSecret() {
    await this.run(async () => {
      this.newSecret.set((await this.request('/settings/webhook/secret', {})).secret);
      await this.loadSettings();
    });
  }
  async testWebhook() {
    await this.run(async () => {
      const r = await this.request('/settings/webhook/test', {});
      this.webhookResult.set(
        r.ok ? 'Conexión correcta: n8n respondió ' + r.status + '.' : 'Falló: ' + r.error,
      );
    });
  }
  async createKey() {
    await this.run(async () => {
      const created = await this.request('/integrations/keys', this.keyForm);
      this.createdKey.set(created.key);
      this.keyForm = { label: '', permissions: [] };
      this.keys.set(await this.request('/integrations/keys'));
    });
  }
  async revokeKey(k: Row) {
    await this.run(async () => {
      await this.request('/integrations/keys/' + k['id'], {}, {}, 'DELETE');
      this.keys.set(await this.request('/integrations/keys'));
      this.message.set('Llave revocada: ' + k['label'] + '.');
    });
  }
  async copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      this.message.set('Copiado al portapapeles.');
    } catch {
      this.error.set('No se pudo copiar; selecciónalo y cópialo a mano.');
    }
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
    clearInterval(this.accessTimer);
  }
}
