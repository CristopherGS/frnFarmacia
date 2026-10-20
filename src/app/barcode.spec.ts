import { TestBed } from '@angular/core/testing';
import { App } from './app';
import { BarcodeCamera } from './barcode-camera';
import { BarcodeScanner } from './barcode-scanner';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

const decoder = vi.hoisted(() => ({ decode: vi.fn() }));
vi.mock('@zxing/browser', () => ({
  BrowserMultiFormatReader: class {
    decodeFromStream = decoder.decode;
  },
}));

describe('Flujos por código de barras', () => {
  let app: App;
  let fixture: ReturnType<typeof TestBed.createComponent<App>>;
  const presentation = {
    id: 7,
    product_id: 3,
    barcode: '0012345678905',
    product_name: 'Producto de prueba',
    name: 'Caja',
    price: 20,
    factor: 10,
    sale_enabled: true,
  };
  beforeEach(() => {
    vi.spyOn(App.prototype, 'restore').mockResolvedValue(undefined);
    fixture = TestBed.createComponent(App);
    app = fixture.componentInstance;
    app.user.set({ username: 'admin', role: 'ADMIN' });
    app.data.set({ presentations: [presentation] });
  });
  afterEach(() => {
    fixture.destroy();
    vi.restoreAllMocks();
  });
  it('selecciona la presentación exacta y conserva ceros iniciales al vender', () => {
    app.openScanner('sale');
    app.handleBarcode('0012345678905');
    expect(app.cart()).toHaveLength(1);
    expect(app.cart()[0]['id']).toBe(7);
    expect(app.cart()[0]['quantity']).toBe(1);
  });
  it('un código desconocido no crea una venta ni una existencia fantasma', () => {
    app.openScanner('sale');
    app.handleBarcode('UNKNOWN');
    expect(app.cart()).toHaveLength(0);
    expect(app.unknownBarcode()).toBe('UNKNOWN');
    app.registerScannedProduct();
    expect(app.product.presentations[0].barcode).toBe('UNKNOWN');
    expect(app.modal()).toBe('product');
  });
  it('no permite a un cajero crear productos por escaneo', () => {
    app.user.set({ role: 'CASHIER' });
    app.openScanner('sale');
    app.handleBarcode('UNKNOWN');
    app.registerScannedProduct();
    expect(app.modal()).toBe('');
    app.openScanner('inventory');
    expect(app.scanTarget()).toBeNull();
  });
  it('recibir un producto existente conserva el lote y el costo capturados', () => {
    app.receipt.lines[0].lot = 'LOTE-A';
    app.receipt.lines[0].totalCost = 125;
    app.openScanner('receipt', 0);
    app.handleBarcode(presentation.barcode);
    expect(app.receipt.lines[0].presentationId).toBe(7);
    expect(app.receipt.lines[0].lot).toBe('LOTE-A');
    expect(app.receipt.lines[0].totalCost).toBe(125);
    expect(app.modal()).toBe('receipt');
  });
  it('no sustituye una línea de recepción que pertenece a otro producto', () => {
    app.receipt.lines[0].presentationId = 99;
    app.openScanner('receipt', 0);
    app.handleBarcode(presentation.barcode);
    expect(app.receipt.lines.map((l) => l.presentationId)).toEqual([99, 7]);
  });
  it('un alta nueva vuelve a recepción sin descontar stock ni cobrar', async () => {
    app.openScanner('inventory');
    app.handleBarcode('NEW123');
    app.registerScannedProduct();
    vi.spyOn(app, 'request').mockResolvedValue({ id: 8 });
    vi.spyOn(app, 'refresh').mockImplementation(async () => {
      app.data.set({
        presentations: [{ ...presentation, product_id: 8, id: 20, barcode: 'NEW123' }],
      });
    });
    await app.saveProduct();
    expect(app.modal()).toBe('receipt');
    expect(app.receipt.lines[0].presentationId).toBe(20);
    expect(app.receipt.lines[0].expiresOn).toBe('');
    expect(app.cart()).toHaveLength(0);
  });
  it('no duplica un código existente al escanear el alta', () => {
    app.openScanner('product', 0);
    app.handleBarcode(presentation.barcode);
    expect(app.product.presentations[0].barcode).toBe('');
    expect(app.error()).toContain('ya pertenece');
  });
  it('el escaneo tampoco permite vender controlados', () => {
    app.data.set({ presentations: [{ ...presentation, controlled: true }] });
    app.openScanner('sale');
    app.handleBarcode(presentation.barcode);
    expect(app.cart()).toHaveLength(0);
    expect(app.error()).toContain('controlados');
  });
});

describe('Ciclo de vida de la cámara', () => {
  const getUserMedia = vi.fn();
  const stop = vi.fn();
  const controls = { stop: vi.fn() };
  let camera: BarcodeCamera;
  beforeEach(() => {
    vi.resetAllMocks();
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia },
    });
    camera = new BarcodeCamera();
    getUserMedia.mockResolvedValue({ getTracks: () => [{ stop }] });
    decoder.decode.mockResolvedValue(controls);
  });
  afterEach(() => {
    camera.stop();
    vi.restoreAllMocks();
  });
  it('solicita solo cámara trasera, entrega una lectura y apaga el video', async () => {
    const found = vi.fn();
    await camera.start(document.createElement('video'), found);
    expect(getUserMedia.mock.calls[0][0].audio).toBe(false);
    expect(getUserMedia.mock.calls[0][0].video.facingMode.ideal).toBe('environment');
    const callback = decoder.decode.mock.calls[0][2];
    callback({ getText: () => '00123' });
    callback({ getText: () => '00123' });
    expect(found).toHaveBeenCalledExactlyOnceWith('00123');
    expect(stop).toHaveBeenCalled();
    expect(controls.stop).toHaveBeenCalled();
  });
  it('libera la cámara incluso si el permiso llega después de cerrar', async () => {
    let resolve!: (value: unknown) => void;
    getUserMedia.mockImplementation(() => new Promise((r) => (resolve = r)));
    const pending = camera.start(document.createElement('video'), vi.fn());
    camera.stop();
    resolve({ getTracks: () => [{ stop }] });
    expect(await pending).toBe(false);
    expect(stop).toHaveBeenCalledOnce();
    expect(decoder.decode).not.toHaveBeenCalled();
  });
  it('explica HTTPS y no solicita permisos desde un origen inseguro', async () => {
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: false });
    await expect(camera.start(document.createElement('video'), vi.fn())).rejects.toThrow('HTTPS');
    expect(getUserMedia).not.toHaveBeenCalled();
  });
  it('permite código manual después de denegar permiso y evita doble envío', async () => {
    const denied = new DOMException('Denied', 'NotAllowedError');
    const fixture = TestBed.configureTestingModule({
      providers: [
        {
          provide: BarcodeCamera,
          useValue: { start: vi.fn().mockRejectedValue(denied), stop: vi.fn() },
        },
      ],
    }).createComponent(BarcodeScanner);
    fixture.detectChanges();
    await fixture.componentInstance.start();
    expect(fixture.componentInstance.status()).toContain('No se autorizó');
    const received = vi.fn();
    fixture.componentInstance.scanned.subscribe(received);
    fixture.componentInstance.manual = '00123';
    fixture.componentInstance.submit();
    fixture.componentInstance.submit();
    expect(received).toHaveBeenCalledExactlyOnceWith('00123');
    fixture.destroy();
  });
});
