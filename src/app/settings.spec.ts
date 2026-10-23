import { TestBed } from '@angular/core/testing';
import { App } from './app';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

vi.mock('@zxing/browser', () => ({ BrowserMultiFormatReader: class {} }));

const settings = {
  name: 'Farmacia Sol',
  type: 'FARMACIA',
  color: '#1c765b',
  modules: ['CASH', 'AUDIT', 'RX'],
  catalog: [],
  roadmap: [],
  types: [
    { key: 'FARMACIA', label: 'Farmacia', noun: 'farmacia', modules: ['CASH', 'AUDIT', 'RX'] },
    { key: 'TIENDA', label: 'Tienda', noun: 'tienda', modules: ['CASH', 'AUDIT'] },
  ],
  webhookUrl: 'https://n8n.local/webhook/x',
  webhookSecretSet: true,
  queue: [],
};
const access = {
  permissions: [
    { key: 'SALES_VIEW', group: 'Ventas', label: 'Ver ventas' },
    { key: 'CATALOG_VIEW', group: 'Catálogo', label: 'Ver productos' },
    { key: 'CATALOG_MANAGE', group: 'Catálogo', label: 'Crear productos' },
  ],
  roles: {},
  implies: { CATALOG_MANAGE: ['CATALOG_VIEW'] },
};

describe('Configuración del negocio e integraciones', () => {
  let app: App;
  let fixture: ReturnType<typeof TestBed.createComponent<App>>;
  beforeEach(() => {
    vi.spyOn(App.prototype, 'restore').mockResolvedValue(undefined);
    vi.spyOn(App.prototype, 'loadBrand').mockResolvedValue(undefined);
    fixture = TestBed.createComponent(App);
    app = fixture.componentInstance;
    app.user.set({
      username: 'admin',
      role: 'ADMIN',
      permissions: ['POS_SELL', 'CASH_VIEW', 'AUDIT_VIEW', 'CATALOG_VIEW'],
      modules: ['CASH', 'AUDIT', 'RX'],
    });
  });
  afterEach(() => {
    fixture.destroy();
    vi.restoreAllMocks();
  });

  it('la marca se toma de la configuración pública: nombre, color y título', async () => {
    vi.restoreAllMocks();
    vi.spyOn(App.prototype, 'restore').mockResolvedValue(undefined);
    fixture = TestBed.createComponent(App);
    app = fixture.componentInstance;
    vi.spyOn(app, 'request').mockResolvedValue({
      name: 'Tienda Luna',
      type: 'TIENDA',
      noun: 'tienda',
      color: '#336699',
    });
    await app.loadBrand();
    expect(app.brand().name).toBe('Tienda Luna');
    expect(app.brandHead()).toBe('Tienda');
    expect(app.brandTail()).toBe('Luna');
    expect(document.title).toContain('Tienda Luna');
    expect(document.documentElement.style.getPropertyValue('--brand')).toBe('#336699');
  });

  it('un nombre de una sola palabra queda completo en la parte destacada', () => {
    app.brand.set({ name: 'Nexo', noun: 'negocio', type: 'OTRO', color: '#000000' });
    expect(app.brandHead()).toBe('');
    expect(app.brandTail()).toBe('Nexo');
  });

  it('sin el módulo de farmacia no se pide receta aunque el producto la tenga', () => {
    app.data.set({ presentations: [], products: [] });
    app.cart.set([{ id: 1, product_id: 1, requires_rx: true, price: 5, quantity: 1, factor: 1 }]);
    expect(app.needsRx()).toBe(true);
    app.user.set({ ...app.user()!, modules: ['CASH', 'AUDIT'] });
    expect(app.rxOn()).toBe(false);
    expect(app.needsRx()).toBe(false);
  });

  it('con un módulo apagado, ni el administrador ve sus pantallas', () => {
    app.user.set({ ...app.user()!, permissions: ['POS_SELL', 'CATALOG_VIEW'], modules: ['RX'] });
    const pages = app.visibleNav().map((n) => n[1]);
    expect(pages).not.toContain('Caja');
    expect(pages).not.toContain('Auditoría');
    expect(pages).toContain('Configuración');
  });

  it('Configuración solo aparece para el administrador', () => {
    expect(app.visibleNav().map((n) => n[1])).toContain('Configuración');
    app.user.set({ username: 'c', role: 'CASHIER', permissions: ['POS_SELL'], modules: [] });
    expect(app.visibleNav().map((n) => n[1])).not.toContain('Configuración');
    app.go('Configuración');
    expect(app.page()).toBe('Resumen');
  });

  it('cambiar el tipo de negocio aplica su plantilla de módulos y luego se ajusta uno a uno', async () => {
    vi.spyOn(app, 'request').mockImplementation(async (path: string) =>
      path === '/settings' ? settings : path === '/users/permissions' ? access : [],
    );
    await app.loadSettings();
    expect(app.settingsForm.modules).toEqual(['CASH', 'AUDIT', 'RX']);
    app.applyBusinessType('TIENDA');
    expect(app.settingsForm.modules).toEqual(['CASH', 'AUDIT']);
    app.toggleModule('AUDIT', false);
    expect(app.settingsForm.modules).toEqual(['CASH']);
    app.toggleModule('RX', true);
    expect(app.settingsForm.modules).toEqual(['CASH', 'RX']);
  });

  it('guarda la configuración con PUT y recarga marca y acceso de la sesión', async () => {
    const calls: unknown[][] = [];
    vi.spyOn(app, 'request').mockImplementation(async (...args: unknown[]) => {
      calls.push(args);
      const path = args[0] as string;
      if (path === '/settings' && !args[1]) return settings;
      if (path === '/settings/public')
        return { name: 'X', noun: 'tienda', type: 'TIENDA', color: '#112233' };
      if (path === '/auth/me')
        return { username: 'admin', role: 'ADMIN', permissions: [], modules: ['CASH'] };
      return path === '/users/permissions' ? access : [];
    });
    vi.spyOn(app, 'refresh').mockResolvedValue(undefined);
    await app.loadSettings();
    app.settingsForm.name = 'Tienda Luna';
    await app.saveSettings();
    const put = calls.find((c) => c[3] === 'PUT')!;
    expect(put[0]).toBe('/settings');
    expect(put[1]).toMatchObject({
      name: 'Tienda Luna',
      webhookUrl: 'https://n8n.local/webhook/x',
    });
    expect(app.user()!['modules']).toEqual(['CASH']);
    expect(app.message()).toContain('Configuración guardada');
  });

  it('el secreto del webhook se muestra una vez y la prueba informa el resultado', async () => {
    const request = vi.spyOn(app, 'request');
    request.mockImplementation(async (path: string) =>
      path === '/settings/webhook/secret'
        ? { secret: 'whsec_abc' }
        : path === '/settings'
          ? settings
          : [],
    );
    await app.newWebhookSecret();
    expect(app.newSecret()).toBe('whsec_abc');
    request.mockResolvedValue({ ok: true, status: 200, error: '' });
    await app.testWebhook();
    expect(app.webhookResult()).toContain('Conexión correcta');
    request.mockResolvedValue({ ok: false, status: 500, error: 'HTTP 500' });
    await app.testWebhook();
    expect(app.webhookResult()).toContain('Falló: HTTP 500');
  });

  it('crea una llave con los permisos elegidos, la muestra una vez y deja el formulario limpio', async () => {
    app.access.set(access);
    app.keyForm.label = 'n8n catálogo';
    app.toggleKeyPermission('CATALOG_MANAGE', true);
    expect(app.keyForm.permissions).toContain('CATALOG_VIEW'); // lo que necesita
    const request = vi.spyOn(app, 'request');
    request.mockImplementation(async (path: string, body?: unknown) =>
      path === '/integrations/keys' && body ? { key: 'sgk_secreta', id: 1 } : [],
    );
    await app.createKey();
    expect(request.mock.calls[0][1]).toEqual({
      label: 'n8n catálogo',
      permissions: expect.arrayContaining(['CATALOG_MANAGE', 'CATALOG_VIEW']),
    });
    expect(app.createdKey()).toBe('sgk_secreta');
    expect(app.keyForm).toEqual({ label: '', permissions: [] });
  });

  it('revocar una llave usa DELETE con la llave elegida', async () => {
    const request = vi.spyOn(app, 'request').mockResolvedValue([]);
    await app.revokeKey({ id: 9, label: 'n8n' });
    const del = request.mock.calls.find((c) => c[3] === 'DELETE')!;
    expect(del[0]).toBe('/integrations/keys/9');
    expect(app.message()).toContain('revocada');
  });
});
