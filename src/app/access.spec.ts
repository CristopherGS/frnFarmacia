import { TestBed } from '@angular/core/testing';
import { App } from './app';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

vi.mock('@zxing/browser', () => ({ BrowserMultiFormatReader: class {} }));

const access = {
  permissions: [
    { key: 'CATALOG_VIEW', group: 'Catálogo', label: 'Ver productos y precios' },
    { key: 'CATALOG_MANAGE', group: 'Catálogo', label: 'Crear productos' },
    { key: 'INVENTORY_VIEW', group: 'Inventario', label: 'Ver existencias' },
    { key: 'COSTS_VIEW', group: 'Inventario', label: 'Ver costos de compra' },
  ],
  roles: { CASHIER: ['CATALOG_VIEW'], ADMIN: [] },
  implies: { CATALOG_MANAGE: ['CATALOG_VIEW'], COSTS_VIEW: ['INVENTORY_VIEW'] },
};

describe('Permisos y administración de usuarios', () => {
  let app: App;
  let fixture: ReturnType<typeof TestBed.createComponent<App>>;
  const as = (role: string, permissions: string[]) =>
    app.user.set({ username: 'u', role, permissions });
  beforeEach(() => {
    vi.spyOn(App.prototype, 'restore').mockResolvedValue(undefined);
    fixture = TestBed.createComponent(App);
    app = fixture.componentInstance;
  });
  afterEach(() => {
    fixture.destroy();
    vi.restoreAllMocks();
  });

  it('el menú muestra solo lo que el administrador permitió', () => {
    as('CASHIER', ['POS_SELL', 'CASH_VIEW']);
    expect(app.visibleNav().map((n) => n[1])).toEqual(['Resumen', 'Punto de venta', 'Caja']);
  });

  it('el administrador ve todo, incluida la administración de usuarios', () => {
    as('ADMIN', []);
    const pages = app.visibleNav().map((n) => n[1]);
    expect(pages).toContain('Usuarios');
    expect(pages).toContain('Auditoría');
    expect(app.canSell() && app.canWrite() && app.canReceive()).toBe(true);
  });

  it('solo el administrador entra a Usuarios, aunque tenga todos los permisos', () => {
    as('SUPERVISOR', ['POS_SELL', 'CATALOG_VIEW', 'AUDIT_VIEW']);
    expect(app.visibleNav().map((n) => n[1])).not.toContain('Usuarios');
    app.go('Usuarios');
    expect(app.page()).toBe('Resumen');
  });

  it('solo pide al servidor las colecciones permitidas', async () => {
    as('INVENTORY', ['INVENTORY_VIEW']);
    const request = vi.spyOn(app, 'request').mockResolvedValue([]);
    await app.refresh();
    const paths = request.mock.calls.map((c) => c[0]);
    expect(paths).toContain('/products');
    expect(paths).toContain('/inventory');
    expect(paths).not.toContain('/sales');
    expect(paths).not.toContain('/audit');
    expect(paths).not.toContain('/suppliers');
  });

  it('un cambio de permisos del administrador se refleja sin recargar', async () => {
    as('CASHIER', ['POS_SELL', 'SALES_VIEW']);
    app.page.set('Ventas');
    vi.spyOn(app, 'refresh').mockResolvedValue(undefined);
    vi.spyOn(app, 'request').mockResolvedValue({
      username: 'u',
      role: 'CASHIER',
      permissions: ['POS_SELL'],
    });
    await app.syncAccess();
    expect(app.canSell()).toBe(true);
    expect(app.visibleNav().map((n) => n[1])).not.toContain('Ventas');
    expect(app.page()).toBe('Resumen');
  });

  it('dar "Crear productos" da también "Ver productos", y quitar lo visible quita lo que depende', () => {
    app.access.set(access);
    app.openUser();
    expect(app.granted('CATALOG_MANAGE')).toBe(false);
    app.togglePermission('CATALOG_MANAGE', true);
    expect(app.granted('CATALOG_VIEW')).toBe(true);
    app.togglePermission('CATALOG_VIEW', false);
    expect(app.granted('CATALOG_MANAGE')).toBe(false);
    app.togglePermission('COSTS_VIEW', true);
    expect(app.granted('INVENTORY_VIEW')).toBe(true);
  });

  it('cambiar el rol aplica la plantilla y el administrador queda con acceso total', () => {
    app.access.set(access);
    app.openUser();
    app.applyRole('CASHIER');
    expect(app.userForm.permissions).toEqual(['CATALOG_VIEW']);
    app.applyRole('ADMIN');
    expect(app.granted('COSTS_VIEW')).toBe(true);
  });

  it('guarda cambios de un usuario con PUT y recarga la lista', async () => {
    app.access.set(access);
    app.openUser({
      id: 5,
      username: 'ana',
      role: 'CASHIER',
      permissions: ['CATALOG_VIEW'],
      active: true,
    });
    app.togglePermission('CATALOG_MANAGE', true);
    const request = vi.spyOn(app, 'request').mockResolvedValue([]);
    await app.saveUser();
    const put = request.mock.calls.find((c) => c[3] === 'PUT')!;
    expect(put[0]).toBe('/users/5');
    expect(put[1]).toEqual({
      role: 'CASHIER',
      permissions: ['CATALOG_VIEW', 'CATALOG_MANAGE'],
      active: true,
    });
    expect(app.modal()).toBe('');
    expect(app.message()).toContain('de inmediato');
  });

  it('crea un usuario con la plantilla elegida', async () => {
    app.access.set(access);
    app.openUser();
    app.userForm.username = 'nuevo';
    app.userForm.password = 'una-clave-segura-larga';
    const request = vi.spyOn(app, 'request').mockResolvedValue([]);
    await app.saveUser();
    const post = request.mock.calls.find((c) => c[0] === '/users' && c[1])!;
    expect(post[1]).toMatchObject({
      username: 'nuevo',
      role: 'CASHIER',
      permissions: ['CATALOG_VIEW'],
    });
  });

  it('un 403 explica que falta permiso en lugar de un error genérico', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({}) }),
    );
    await expect(app.request('/audit')).rejects.toThrow('No tienes permiso');
    vi.unstubAllGlobals();
  });
});
