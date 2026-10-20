import {
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  OnDestroy,
  Output,
  ViewChild,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BarcodeCamera } from './barcode-camera';

@Component({
  selector: 'app-barcode-scanner',
  imports: [FormsModule],
  templateUrl: './barcode-scanner.html',
  styleUrl: './barcode-scanner.css',
})
export class BarcodeScanner implements OnDestroy {
  @ViewChild('preview', { static: true }) preview!: ElementRef<HTMLVideoElement>;
  @Output() scanned = new EventEmitter<string>();
  @Output() dismissed = new EventEmitter<void>();
  status = signal('Pulsa Abrir cámara y permite el acceso cuando lo solicite el navegador.');
  starting = signal(false);
  running = signal(false);
  manual = '';
  private delivered = false;
  private destroyed = false;
  constructor(private camera: BarcodeCamera) {}
  async start() {
    if (this.starting() || this.running()) return;
    this.starting.set(true);
    this.status.set('Esperando acceso a la cámara…');
    try {
      const active = await this.camera.start(this.preview.nativeElement, (code) =>
        this.deliver(code),
      );
      if (this.destroyed || this.delivered) return;
      this.running.set(active);
      if (active) this.status.set('Buscando código. Acerca o aleja lentamente el envase.');
    } catch (error) {
      if (this.destroyed) return;
      const name = (error as Error).name;
      this.status.set(
        name === 'NotAllowedError'
          ? 'No se autorizó la cámara. Puedes permitirla en el navegador o escribir el código.'
          : name === 'NotFoundError'
            ? 'No se encontró una cámara. Puedes usar el código manual.'
            : name === 'NotReadableError'
              ? 'La cámara está ocupada. Cierra otras aplicaciones y vuelve a intentar.'
              : (error as Error).message ||
                'No se pudo abrir la cámara. Escribe el código manualmente.',
      );
    } finally {
      this.starting.set(false);
    }
  }
  submit() {
    this.deliver(this.manual.trim());
  }
  private deliver(code: string) {
    if (this.delivered || this.destroyed) return;
    this.running.set(false);
    if (!/^[\x21-\x7E]{1,100}$/.test(code)) {
      this.status.set('El código debe contener de 1 a 100 caracteres sin espacios.');
      return;
    }
    this.delivered = true;
    this.camera.stop();
    this.scanned.emit(code);
  }
  close() {
    this.camera.stop();
    this.dismissed.emit();
  }
  @HostListener('document:keydown.escape') escape() {
    this.close();
  }
  @HostListener('document:visibilitychange') visibility() {
    if (document.hidden) {
      this.camera.stop();
      this.running.set(false);
      this.status.set('Cámara pausada. Pulsa Abrir cámara para continuar.');
    }
  }
  ngOnDestroy() {
    this.destroyed = true;
    this.camera.stop();
  }
}
