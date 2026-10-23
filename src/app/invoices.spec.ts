import { TestBed } from '@angular/core/testing';
import { App } from './app';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

vi.mock('@zxing/browser', () => ({ BrowserMultiFormatReader: class {} }));

const draft = {
  id: 7,
  status: 'READY',
  filename: 'factura.jpg',
  content_type: 'image/jpeg',
  supplier_id: 1,
  document: 'FAC-99',
  lines: [
    {
      description: 'Acetaminofén 500',
      presentation_id: 11,
      method: 'BARCODE',
      confidence: 1,
      quantity: '3.000',
      lot: 'L1',
      expires_on: '2028-05-01',
      total_cost: '135.50',
    },
    {
      description: 'Amoxicilina caja',
      presentation_id: 31,
      method: 'NAME',
      confidence: 0.62,
      quantity: '2.000',
      lot: '',
      expires_on: null,
      total_cost: '80.00',
    },
    {
      description: 'Flete y manejo',
      presentation_id: null,
      method: '',
      confidence: 0,
      quantity: null,
      lot: '',
      expires_on: null,
      total_cost: '15.00',
    },
  ],
};

describe('Facturas de proveedores', () => {
  let app: App;
  let fixture: ReturnType<typeof TestBed.createComponent<App>>;
  beforeEach(() => {
    vi.spyOn(App.prototype, 'restore').mockResolvedValue(undefined);
    vi.spyOn(App.prototype, 'loadBrand').mockResolvedValue(undefined);
    fixture = TestBed.createComponent(App);
    app = fixture.componentInstance;
    app.user.set({
      username: 'compras',
      role: 'INVENTORY',
      permissions: [
        'PURCHASES_VIEW',
        'PURCHASES_RECEIVE',
        'INVOICES_IMPORT',
        'CATALOG_VIEW',
        'SUPPLIERS_VIEW',
      ],
      modules: [],
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
  });
  afterEach(() => {
    fixture.destroy();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('sube la factura como archivo, sin forzar el tipo de contenido JSON', async () => {
    const request = vi.spyOn(app, 'request').mockResolvedValue([]);
    const file = new File(['x'], 'factura.jpg', { type: 'image/jpeg' });
    const input = document.createElement('input');
    Object.defineProperty(input, 'files', { value: [file] });
    await app.uploadInvoice({ target: input } as unknown as Event);
    const upload = request.mock.calls.find((c) => c[0] === '/receipts/drafts' && c[1])!;
    expect(upload[1]).toBeInstanceOf(FormData);
    expect((upload[1] as FormData).get('file')).toBe(file);
    expect(app.message()).toContain('La estamos leyendo');
  });

  it('el archivo se envía con el token CSRF y sin Content-Type propio', async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    vi.stubGlobal('fetch', f);
    app.csrf = 'tok';
    await app.request('/receipts/drafts', new FormData());
    const init = f.mock.calls[0][1];
    expect(init.headers['X-XSRF-TOKEN']).toBe('tok');
    expect(init.headers['Content-Type']).toBeUndefined();
    expect(init.body).toBeInstanceOf(FormData);
  });

  it('revisar un borrador precarga la recepción y marca lo que conviene revisar', async () => {
    vi.spyOn(app, 'request').mockResolvedValue(draft);
    const refresh = vi.spyOn(app, 'refresh').mockResolvedValue(undefined);
    await app.reviewDraft({ id: 7, content_type: 'image/jpeg', filename: 'factura.jpg' });
    expect(refresh).toHaveBeenCalledWith(['suppliers', 'presentations', 'products']);
    expect(app.modal()).toBe('receipt');
    expect(app.draftId()).toBe(7);
    expect(app.receipt.supplierId).toBe(1);
    expect(app.receipt.document).toBe('FAC-99');
    const [exact, byName, none] = app.receipt.lines;
    expect([exact.presentationId, exact.quantity, exact.lot, exact.low]).toEqual([
      11,
      3,
      'L1',
      false,
    ]);
    expect(byName.low).toBe(true);
    expect(byName.hint).toContain('sugerido por nombre (62%)');
    expect(none.presentationId).toBe(0);
    expect(none.hint).toContain('elige el producto');
    expect(none.quantity).toBe(1); // sin cantidad legible, el mínimo válido
  });

  it('al confirmar usa el borrador y no envía los avisos de pantalla', async () => {
    vi.spyOn(app, 'request').mockResolvedValue(draft);
    const refresh = vi.spyOn(app, 'refresh').mockResolvedValue(undefined);
    await app.reviewDraft({ id: 7, content_type: 'image/jpeg', filename: 'f.jpg' });
    const request = vi.spyOn(app, 'request').mockResolvedValue([]);
    vi.spyOn(app, 'refresh').mockResolvedValue(undefined);
    app.receipt.lines[2].presentationId = 12;
    await app.saveReceipt();
    const confirm = request.mock.calls.find((c) => c[0] === '/receipts/drafts/7/confirm')!;
    expect(Object.keys((confirm[1] as { lines: object[] }).lines[0]).sort()).toEqual([
      'expiresOn',
      'lot',
      'presentationId',
      'quantity',
      'totalCost',
    ]);
    expect(app.draftId()).toBeNull();
    expect(app.modal()).toBe('');
  });

  it('una recepción normal no pasa por borradores', async () => {
    const request = vi.spyOn(app, 'request').mockResolvedValue([]);
    vi.spyOn(app, 'refresh').mockResolvedValue(undefined);
    app.receipt.supplierId = 1;
    await app.saveReceipt();
    expect(request.mock.calls.some((c) => c[0] === '/receipts')).toBe(true);
    expect(request.mock.calls.some((c) => String(c[0]).includes('/drafts/'))).toBe(false);
  });

  it('cerrar el diálogo suelta el borrador y la vista previa', async () => {
    vi.spyOn(app, 'request').mockResolvedValue(draft);
    const refresh = vi.spyOn(app, 'refresh').mockResolvedValue(undefined);
    await app.reviewDraft({ id: 7, content_type: 'image/jpeg', filename: 'f.jpg' });
    app.closeModal();
    expect(app.draftId()).toBeNull();
    expect(app.draftPreview()).toBeNull();
  });

  it('descartar una factura la quita de la lista', async () => {
    const request = vi.spyOn(app, 'request').mockResolvedValue([]);
    await app.discardDraft({ id: 3 });
    expect(request).toHaveBeenCalledWith('/receipts/drafts/3/discard', {});
    expect(app.message()).toContain('descartada');
  });

  it('quien no puede cargar ni recibir facturas no pide la lista', async () => {
    app.user.set({ username: 'c', role: 'CASHIER', permissions: ['POS_SELL'], modules: [] });
    const request = vi.spyOn(app, 'request').mockResolvedValue([]);
    await app.loadDrafts();
    expect(request).not.toHaveBeenCalled();
  });

  it('los estados se muestran en español claro', () => {
    expect(app.statusLabel({ status: 'PENDING' })).toBe('Leyendo…');
    expect(app.statusLabel({ status: 'READY' })).toBe('Lista para revisar');
    expect(app.statusLabel({ status: 'FAILED' })).toBe('No se pudo leer');
  });
});
