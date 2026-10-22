import { TestBed } from '@angular/core/testing';
import { App } from './app';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

vi.mock('@zxing/browser', () => ({ BrowserMultiFormatReader: class {} }));

describe('Punto de venta', () => {
  let app: App;
  let fixture: ReturnType<typeof TestBed.createComponent<App>>;
  const caja = {
    id: 7,
    product_id: 3,
    barcode: '0012345678905',
    product_name: 'Acetaminofén 500 mg',
    generic_name: 'Paracetamol',
    name: 'Caja',
    price: 20,
    factor: 10,
    sale_enabled: true,
  };
  const tableta = {
    ...caja,
    id: 8,
    barcode: '0012345678912',
    name: 'Tableta',
    price: 2.5,
    factor: 1,
  };
  const jarabe = {
    ...caja,
    id: 9,
    product_id: 4,
    barcode: '7400000000017',
    product_name: 'Amoxicilina jarabe',
    generic_name: 'Amoxicilina',
    name: 'Frasco',
    price: 37.5,
    factor: 1,
    requires_rx: true,
  };
  beforeEach(() => {
    vi.spyOn(App.prototype, 'restore').mockResolvedValue(undefined);
    fixture = TestBed.createComponent(App);
    app = fixture.componentInstance;
    app.user.set({ username: 'caja', role: 'CASHIER' });
    app.data.set({
      presentations: [caja, tableta, jarabe],
      products: [
        { id: 3, stock: 25 },
        { id: 4, stock: 5 },
      ],
      cash: [{ id: 1, closed_at: null }],
    });
  });
  afterEach(() => {
    fixture.destroy();
    vi.restoreAllMocks();
  });

  it('un lector USB (código + Enter) agrega la presentación y limpia el buscador', () => {
    app.search.set('0012345678905');
    app.searchEnter();
    expect(app.cart().map((l) => [l['id'], l['quantity']])).toEqual([[7, 1]]);
    expect(app.search()).toBe('');
    expect(app.message()).toContain('Agregado');
  });

  it('Enter con un único resultado por nombre genérico lo agrega', () => {
    app.search.set('amoxi');
    app.searchEnter();
    expect(app.cart().map((l) => l['id'])).toEqual([9]);
  });

  it('Enter con varios resultados no agrega nada', () => {
    app.search.set('paracetamol');
    app.searchEnter();
    expect(app.cart()).toHaveLength(0);
    expect(app.posMatches()).toHaveLength(2);
  });

  it('no permite vender más que la existencia, sumando todas las presentaciones', () => {
    app.add(caja);
    app.add(caja); // 20 de 25 unidades base
    expect(app.remaining(caja)).toBe(0);
    expect(app.add(caja)).toBe(false);
    expect(app.error()).toContain('Sin existencias');
    expect(app.remaining(tableta)).toBe(5);
    app.add(tableta);
    app.quantity(8, 4);
    app.quantity(8, 1);
    expect(app.cart().find((l) => l['id'] === 8)?.['quantity']).toBe(5);
  });

  it('oculta presentaciones no habilitadas para venta', () => {
    app.data.update((d) => ({
      ...d,
      presentations: [caja, { ...tableta, sale_enabled: false }],
    }));
    expect(app.posResults().map((p) => p['id'])).toEqual([7]);
  });

  it('exige la receta solo si el carrito la requiere', () => {
    app.add(caja);
    app.tendered = app.total();
    expect(app.needsRx()).toBe(false);
    expect(app.canCheckout()).toBe(true);
    app.add(jarabe);
    app.tendered = app.total();
    expect(app.needsRx()).toBe(true);
    expect(app.canCheckout()).toBe(false);
    app.prescription = true;
    expect(app.canCheckout()).toBe(true);
  });

  it('calcula cambio, faltante y billetes sugeridos en efectivo', () => {
    app.add(jarabe);
    expect(app.cashOptions()).toEqual([37.5, 40, 50, 100]);
    app.tendered = 30;
    expect(app.missing()).toBe(7.5);
    expect(app.canCheckout()).toBe(false);
    app.tendered = 50;
    expect(app.change()).toBe(12.5);
    expect(app.canCheckout()).toBe(false); // falta la receta
  });

  it('el pago electrónico envía el importe exacto', async () => {
    app.add(caja);
    app.setPayment('CARD');
    app.tendered = 999;
    const request = vi.spyOn(app, 'request').mockResolvedValue({ id: 5, change_amount: 0 });
    vi.spyOn(app, 'refresh').mockResolvedValue(undefined);
    await app.checkout();
    expect(request.mock.calls[0][1]).toMatchObject({ method: 'CARD', tendered: 20 });
    expect(app.cart()).toHaveLength(0);
  });

  it('tras un 409 recarga datos y actualiza el precio del carrito', async () => {
    app.add(caja);
    vi.spyOn(app, 'request').mockImplementation(async (path: string) => {
      if (path === '/sales/checkout')
        throw Object.assign(new Error('El precio cambió'), { status: 409 });
      if (path === '/presentations') return [{ ...caja, price: 22 }, tableta, jarabe];
      if (path === '/products') return [{ id: 3, stock: 25 }];
      return [];
    });
    await app.checkout();
    expect(app.error()).toBe('El precio cambió');
    expect(app.cart()[0]['price']).toBe(22);
    expect(app.tendered).toBe(22);
    expect(app.message()).toContain('precios');
  });
});
