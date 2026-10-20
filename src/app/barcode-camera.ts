import { Injectable } from '@angular/core';
import type { IScannerControls } from '@zxing/browser';

@Injectable({ providedIn: 'root' })
export class BarcodeCamera {
  private generation = 0;
  private stream?: MediaStream;
  private controls?: IScannerControls;

  async start(video: HTMLVideoElement, onCode: (code: string) => void): Promise<boolean> {
    this.stop();
    const generation = this.generation;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      throw new Error(
        'Para usar la cámara, abre el sistema mediante una conexión HTTPS confiable. También puedes escribir el código.',
      );
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
    });
    if (generation !== this.generation) {
      stream.getTracks().forEach((track) => track.stop());
      return false;
    }
    this.stream = stream;
    try {
      const { BrowserMultiFormatReader } = await import('@zxing/browser');
      if (generation !== this.generation) return false;
      const reader = new BrowserMultiFormatReader(undefined, {
        delayBetweenScanAttempts: 180,
        delayBetweenScanSuccess: 500,
      });
      const controls = await reader.decodeFromStream(stream, video, (result) => {
        if (!result || generation !== this.generation) return;
        const code = result.getText().trim();
        if (!code) return;
        this.stop();
        onCode(code);
      });
      if (generation !== this.generation) {
        controls.stop();
        return false;
      }
      this.controls = controls;
      return true;
    } catch (error) {
      if (generation === this.generation) this.stop();
      throw error;
    }
  }

  stop() {
    this.generation++;
    this.controls?.stop();
    this.controls = undefined;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = undefined;
  }
}
