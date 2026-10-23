import { TestBed } from '@angular/core/testing';
import { App } from './app';
import { Invest } from './invest';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

vi.mock('@zxing/browser', () => ({ BrowserMultiFormatReader: class {} }));

describe('Inversiones (solo para el dueño)', () => {
  let app: App;
  let fixture: ReturnType<typeof TestBed.createComponent<App>>;
  beforeEach(() => {
    vi.spyOn(App.prototype, 'restore').mockResolvedValue(undefined);
    fixture = TestBed.createComponent(App);
    app = fixture.componentInstance;
  });
  afterEach(() => {
    fixture.destroy();
    vi.restoreAllMocks();
  });

  it('el menú solo muestra Inversiones cuando el servidor lo habilita', () => {
    app.user.set({ username: 'a', role: 'ADMIN', permissions: [], modules: [] });
    expect(app.visibleNav().map((n) => n[1])).not.toContain('Inversiones');
    app.user.set({
      username: 'a',
      role: 'ADMIN',
      permissions: [],
      modules: [],
      features: { invest: false },
    });
    expect(app.visibleNav().map((n) => n[1])).not.toContain('Inversiones');
    app.user.set({
      username: 'a',
      role: 'ADMIN',
      permissions: [],
      modules: [],
      features: { invest: true },
    });
    expect(app.visibleNav().map((n) => n[1])).toContain('Inversiones');
  });

  it('un administrador que no es el dueño no puede entrar por go()', () => {
    app.user.set({ username: 'a', role: 'ADMIN', permissions: [], modules: [], features: {} });
    app.go('Inversiones');
    expect(app.page()).toBe('Resumen');
  });
});

describe('Formato del panel de inversiones', () => {
  const make = () => {
    const f = TestBed.createComponent(Invest);
    f.componentRef.setInput('api', vi.fn().mockResolvedValue({ empty: true }));
    return f.componentInstance;
  };

  it('escribe la meta en años y meses, y avisa si no se alcanza', () => {
    const c = make();
    expect(
      c.eta({ progressPct: 31, monthsLeft: 30, etaDate: '2029-04-23', assumedAnnualReturnPct: 6 }),
    ).toContain('2 años y 6 meses');
    expect(c.eta({ progressPct: 100 })).toContain('alcanzada');
    expect(c.eta({ progressPct: 5, monthsLeft: null })).toContain('Sube el aporte');
  });

  it('muestra porcentajes con signo y menos tipográfico', () => {
    const c = make();
    expect(c.pct(-2.234, 1)).toBe('−2.2%');
    expect(c.pct(1.5, 1, true)).toBe('+1.5%');
    expect(c.pct(null)).toBe('—');
  });

  it('convierte las reglas de caída guardadas en negativo a positivo y de vuelta', async () => {
    const api = vi.fn(async (path: string, body?: unknown, _e?: unknown, method?: string) => {
      if (path === '/invest/config' && method === 'PUT') return body;
      if (path === '/invest/config')
        return {
          target: { VOO: 100 },
          classes: { VOO: 'equity_us' },
          dropRules: [{ atPct: -10, title: 'a', action: 'b', needsEmergencyFund: false }],
        };
      return [];
    });
    const f = TestBed.createComponent(Invest);
    f.componentRef.setInput('api', api);
    const c = f.componentInstance;
    await c.loadSettings();
    expect(c.cfg()!['dropRows'][0].depth).toBe(10);
    await c.saveConfig();
    const put = api.mock.calls.find((x) => x[3] === 'PUT')!;
    expect((put[1] as any).dropRules[0].atPct).toBe(-10);
    expect((put[1] as any).target).toEqual({ VOO: 100 });
    expect(put[1]).not.toHaveProperty('targetRows');
  });
});
