import {
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { GLOSSARY, GlossaryEntry } from './invest-glossary';

type Row = Record<string, any>;
export type InvestApi = (
  path: string,
  body?: unknown,
  extra?: Record<string, string>,
  method?: string,
) => Promise<any>;

const TABS = [
  'Hoy',
  'Semáforo',
  'Portafolio',
  'Riesgo',
  'Caídas',
  'Compras',
  'Noticias',
  'Aprende',
  'Ajustes',
] as const;
type Tab = (typeof TABS)[number];

/**
 * Portafolio personal de ETFs. Se carga solo cuando el dueño entra a «Inversiones» (@defer), y la
 * librería de gráficas se descarga recién al abrir una pestaña con gráficas.
 */
@Component({
  selector: 'app-invest',
  imports: [CommonModule, FormsModule],
  templateUrl: './invest.html',
  styleUrl: './invest.css',
  host: { '[attr.data-theme]': 'theme()' },
})
export class Invest implements OnInit, OnDestroy {
  api = input.required<InvestApi>();
  tabs = TABS;
  tab = signal<Tab>('Hoy');
  theme = signal<'light' | 'dark'>(this.initialTheme());
  d = signal<Row | null>(null);
  loading = signal(true);
  refreshing = signal(false);
  error = signal('');
  notice = signal('');
  term = signal<GlossaryEntry | null>(null);
  glossary = GLOSSARY;
  glossaryFilter = signal('');

  // ---- ajustes ----
  cfg = signal<Row | null>(null);
  positions = signal<Row[]>([]);
  contributions = signal<Row[]>([]);
  posForm: Row = this.emptyPosition();
  editingPosition = signal<number | null>(null);
  contribForm: Row = { day: this.today(), gtq: 0, fx: 7.7 };
  classes = [
    ['equity_us', 'Acciones EE. UU.'],
    ['equity_intl', 'Acciones internacionales'],
    ['bonds', 'Bonos'],
    ['cash', 'Efectivo / T-Bills'],
  ];

  private charts: any[] = [];
  private poll: ReturnType<typeof setInterval> | null = null;
  private host = inject(ElementRef<HTMLElement>);

  holdings = computed<Row[]>(() => this.d()?.['portfolio']?.['holdings'] ?? []);
  glossaryShown = computed(() => {
    const f = this.glossaryFilter().trim().toLowerCase();
    return f
      ? this.glossary.filter((g) => (g.title + ' ' + g.text).toLowerCase().includes(f))
      : this.glossary;
  });
  staleSources = computed<string[]>(() => {
    const s = this.d()?.['sources'];
    const out: string[] = [];
    if (!s) return out;
    for (const [group, items] of Object.entries<Row>(s)) {
      if (group === 'fx' || group === 'news') {
        if (items['stale']) out.push(this.sourceLabel(group, items));
        continue;
      }
      for (const [name, info] of Object.entries<Row>(items)) {
        if (info['stale']) out.push(this.sourceLabel(name, info));
      }
    }
    return out;
  });

  ngOnInit() {
    void this.load();
  }

  ngOnDestroy() {
    this.stopPolling();
    this.destroyCharts();
  }

  // ---- formato ----
  today() {
    return new Date().toISOString().slice(0, 10);
  }
  q(v: unknown, digits = 0) {
    return new Intl.NumberFormat('es-GT', {
      style: 'currency',
      currency: 'GTQ',
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(Number(v || 0));
  }
  usd(v: unknown, digits = 2) {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(Number(v || 0));
  }
  pct(v: unknown, digits = 2, sign = false) {
    if (v === null || v === undefined || v === '') return '—';
    const n = Number(v);
    return (sign && n > 0 ? '+' : '') + n.toFixed(digits).replace('-', '−') + '%';
  }
  num(v: unknown, digits = 2) {
    return v === null || v === undefined ? '—' : Number(v).toFixed(digits);
  }
  day(v: unknown) {
    if (!v) return '—';
    const d = new Date(String(v).slice(0, 10) + 'T12:00:00');
    return d.toLocaleDateString('es-GT', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  tone(v: unknown) {
    const n = Number(v);
    return n > 0 ? 'up' : n < 0 ? 'down' : '';
  }
  stateLabel(s: string) {
    return s === 'verde'
      ? '🟢 Tranquilo'
      : s === 'amarillo'
        ? '🟡 Atento'
        : s === 'rojo'
          ? '🔴 Cuidado'
          : '⚪ Sin dato';
  }
  eta(goal: Row | undefined) {
    if (!goal) return '';
    if (goal['progressPct'] >= 100) return '¡Meta alcanzada!';
    const m = goal['monthsLeft'];
    if (m === null || m === undefined)
      return 'Con los supuestos actuales no se llega a la meta en 100 años. Sube el aporte o la meta.';
    const y = Math.floor(m / 12);
    const rest = m % 12;
    const span = [
      y ? y + (y === 1 ? ' año' : ' años') : '',
      rest ? rest + (rest === 1 ? ' mes' : ' meses') : '',
    ]
      .filter(Boolean)
      .join(' y ');
    return `Al ritmo actual llegarías en ${span} (${this.day(goal['etaDate'])}), suponiendo ${goal['assumedAnnualReturnPct']}% anual.`;
  }
  monthsText(v: unknown) {
    if (v === null || v === undefined) return '—';
    const m = Number(v);
    return m < 12 ? m.toFixed(1) + ' meses' : (m / 12).toFixed(1) + ' años';
  }
  private sourceLabel(name: string, info: Row) {
    const names: Record<string, string> = {
      fx: 'Tipo de cambio',
      news: 'Noticias',
      VIXCLS: 'VIX',
      DGS10: 'Bono a 10 años',
      DGS2: 'Bono a 2 años',
      T10Y2Y: 'Curva 10-2',
      BAMLH0A0HYM2: 'Spread alto riesgo',
      FEDFUNDS: 'Tasa de la Fed',
      CPIAUCSL: 'Inflación',
    };
    const when = info['asOf'] ? ' (último dato: ' + this.day(info['asOf']) + ')' : ' (sin datos)';
    return (names[name] ?? name) + when;
  }

  // ---- navegación, tema y glosario ----
  show(t: Tab) {
    this.tab.set(t);
    this.error.set('');
    this.notice.set('');
    if (t === 'Ajustes') void this.loadSettings();
    setTimeout(() => void this.drawCharts(), 0);
    this.host.nativeElement.scrollIntoView?.({ block: 'start' });
  }
  toggleTheme() {
    const next = this.theme() === 'dark' ? 'light' : 'dark';
    this.theme.set(next);
    try {
      localStorage.setItem('invest-theme', next);
    } catch {}
    setTimeout(() => void this.drawCharts(), 0);
  }
  private initialTheme(): 'light' | 'dark' {
    try {
      const saved = localStorage.getItem('invest-theme');
      if (saved === 'light' || saved === 'dark') return saved;
    } catch {}
    return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
  }
  openTerm(key: string) {
    this.term.set(this.glossary.find((g) => g.key === key) ?? null);
  }
  closeTerm() {
    this.term.set(null);
  }
  openGlossary(key?: string) {
    this.term.set(null);
    this.glossaryFilter.set('');
    this.show('Aprende');
    if (key)
      setTimeout(
        () =>
          this.host.nativeElement.querySelector('#g-' + key)?.scrollIntoView?.({ block: 'center' }),
        50,
      );
  }

  // ---- datos ----
  async load() {
    this.loading.set(true);
    try {
      const data = await this.api()('/invest/latest');
      this.d.set(data?.empty ? null : data);
      if (data?.fx?.gtqPerUsd) this.contribForm['fx'] = data.fx.gtqPerUsd;
    } catch (e) {
      this.error.set((e as Error).message);
    } finally {
      this.loading.set(false);
      setTimeout(() => void this.drawCharts(), 0);
    }
  }

  async refresh() {
    if (this.refreshing()) return;
    this.refreshing.set(true);
    this.error.set('');
    this.notice.set('Actualizando precios, mercado y noticias… tarda unos segundos.');
    try {
      await this.api()('/invest/refresh', {});
      this.startPolling();
    } catch (e) {
      this.refreshing.set(false);
      this.notice.set('');
      this.error.set((e as Error).message);
    }
  }

  private startPolling() {
    this.stopPolling();
    let ticks = 0;
    this.poll = setInterval(async () => {
      ticks++;
      try {
        const s = await this.api()('/invest/status');
        if (!s.running || ticks > 90) {
          this.stopPolling();
          this.refreshing.set(false);
          this.notice.set('');
          if (s.error) this.error.set('La actualización terminó con un error: ' + s.error);
          await this.load();
        }
      } catch (e) {
        this.stopPolling();
        this.refreshing.set(false);
        this.error.set((e as Error).message);
      }
    }, 2000);
  }
  private stopPolling() {
    if (this.poll) clearInterval(this.poll);
    this.poll = null;
  }

  // ---- ajustes: plan, posiciones y aportes ----
  emptyPosition(): Row {
    return { ticker: '', shares: 0, avgPriceUsd: 0, boughtOn: this.today() };
  }

  async loadSettings() {
    try {
      const [cfg, pos, con] = await Promise.all([
        this.api()('/invest/config'),
        this.api()('/invest/positions'),
        this.api()('/invest/contributions'),
      ]);
      cfg.targetRows = Object.entries<number>(cfg.target).map(([ticker, pct]) => ({
        ticker,
        pct,
        cls: cfg.classes?.[ticker] ?? 'equity_us',
      }));
      // en el plan guardado las caídas son negativas (-10); en pantalla se escriben en positivo (10)
      cfg.dropRows = cfg.dropRules.map((r: Row) => ({ ...r, depth: Math.abs(r['atPct']) }));
      this.cfg.set(cfg);
      this.positions.set(pos);
      this.contributions.set(con);
    } catch (e) {
      this.error.set((e as Error).message);
    }
  }

  targetSum() {
    return (this.cfg()?.['targetRows'] ?? []).reduce(
      (s: number, r: Row) => s + Number(r['pct'] || 0),
      0,
    );
  }
  addTarget() {
    this.cfg()?.['targetRows'].push({ ticker: '', pct: 0, cls: 'equity_us' });
  }
  removeTarget(i: number) {
    this.cfg()?.['targetRows'].splice(i, 1);
  }
  addDropRule() {
    this.cfg()?.['dropRows'].push({ depth: 10, title: '', action: '', needsEmergencyFund: false });
  }
  removeDropRule(i: number) {
    this.cfg()?.['dropRows'].splice(i, 1);
  }

  async saveConfig() {
    const c = this.cfg();
    if (!c) return;
    this.error.set('');
    this.notice.set('');
    const target: Record<string, number> = {};
    const classes: Record<string, string> = {};
    for (const r of c['targetRows']) {
      const t = String(r.ticker || '')
        .trim()
        .toUpperCase();
      if (!t) continue;
      target[t] = Number(r.pct);
      classes[t] = r.cls;
    }
    const { targetRows: _rows, dropRows, ...rest } = c;
    const body = {
      ...rest,
      target,
      classes,
      dropRules: dropRows.map((r: Row) => ({
        atPct: -Math.abs(Number(r['depth'])),
        title: r['title'],
        action: r['action'],
        needsEmergencyFund: !!r['needsEmergencyFund'],
      })),
    };
    try {
      await this.api()('/invest/config', body, {}, 'PUT');
      this.notice.set(
        'Plan guardado. Pulsa «Actualizar» para recalcular el resumen con este plan.',
      );
    } catch (e) {
      this.error.set((e as Error).message);
    }
  }

  editPosition(p: Row) {
    this.editingPosition.set(p['id']);
    this.posForm = {
      ticker: p['ticker'],
      shares: Number(p['shares']),
      avgPriceUsd: Number(p['avgPriceUsd']),
      boughtOn: p['boughtOn'],
    };
  }
  cancelPosition() {
    this.editingPosition.set(null);
    this.posForm = this.emptyPosition();
  }
  async savePosition() {
    this.error.set('');
    const body = {
      ticker: String(this.posForm['ticker']).trim().toUpperCase(),
      shares: Number(this.posForm['shares']),
      avgPriceUsd: Number(this.posForm['avgPriceUsd']),
      boughtOn: this.posForm['boughtOn'],
    };
    try {
      const id = this.editingPosition();
      if (id === null) await this.api()('/invest/positions', body);
      else await this.api()('/invest/positions/' + id, body, {}, 'PUT');
      this.cancelPosition();
      this.notice.set('Posición guardada. Pulsa «Actualizar» para recalcular.');
      await this.loadSettings();
    } catch (e) {
      this.error.set((e as Error).message);
    }
  }
  async deletePosition(p: Row) {
    if (!confirm(`¿Quitar ${p['ticker']} (${p['shares']} acciones)?`)) return;
    try {
      await this.api()('/invest/positions/' + p['id'], {}, {}, 'DELETE');
      await this.loadSettings();
    } catch (e) {
      this.error.set((e as Error).message);
    }
  }
  async saveContribution() {
    this.error.set('');
    try {
      await this.api()('/invest/contributions', {
        day: this.contribForm['day'],
        gtq: Number(this.contribForm['gtq']),
        fx: Number(this.contribForm['fx']),
      });
      this.contribForm['gtq'] = 0;
      await this.loadSettings();
    } catch (e) {
      this.error.set((e as Error).message);
    }
  }
  async deleteContribution(c: Row) {
    if (!confirm('¿Quitar este aporte?')) return;
    try {
      await this.api()('/invest/contributions/' + c['id'], {}, {}, 'DELETE');
      await this.loadSettings();
    } catch (e) {
      this.error.set((e as Error).message);
    }
  }
  contributedGtq() {
    return this.contributions().reduce((s, c) => s + Number(c['gtq']), 0);
  }

  // ---- gráficas (Chart.js se descarga la primera vez que hacen falta) ----
  private destroyCharts() {
    this.charts.forEach((c) => c.destroy());
    this.charts = [];
  }

  private css(name: string) {
    return getComputedStyle(this.host.nativeElement).getPropertyValue(name).trim() || '#888';
  }

  async drawCharts() {
    const data = this.d();
    const t = this.tab();
    this.destroyCharts();
    if (!data || !['Portafolio', 'Riesgo', 'Hoy'].includes(t)) return;
    const el = this.host.nativeElement as HTMLElement;
    const { Chart, registerables } = await import('chart.js');
    Chart.register(...registerables);
    // la pestaña pudo cambiar mientras se descargaba la librería
    if (this.tab() !== t) return;
    const text = this.css('--muted');
    const grid = this.css('--line');
    const base = {
      responsive: true,
      maintainAspectRatio: false,
      animation: false as const,
      interaction: { mode: 'index' as const, intersect: false },
      plugins: { legend: { labels: { color: text, boxWidth: 12 } } },
      scales: {
        x: { ticks: { color: text, maxTicksLimit: 6 }, grid: { color: grid } },
        y: { ticks: { color: text }, grid: { color: grid } },
      },
    };
    const make = (id: string, config: any) => {
      const canvas = el.querySelector<HTMLCanvasElement>('#' + id);
      if (canvas) this.charts.push(new Chart(canvas, config));
    };
    const c = data['charts'] ?? {};
    const dates: string[] = c['dates'] ?? [];
    if (dates.length > 1) {
      make('ch-growth', {
        type: 'line',
        data: {
          labels: dates,
          datasets: [
            {
              label: 'Mi portafolio',
              data: c['portfolioUsd'],
              borderColor: this.css('--brand'),
              backgroundColor: this.css('--brand'),
              borderWidth: 2,
              pointRadius: 0,
            },
            {
              label: 'Lo mismo en el S&P 500',
              data: c['sp500Usd'],
              borderColor: this.css('--blue'),
              borderDash: [6, 4],
              borderWidth: 2,
              pointRadius: 0,
            },
            {
              label: 'Lo que he aportado',
              data: c['contributedUsd'],
              borderColor: this.css('--muted'),
              borderWidth: 1.5,
              pointRadius: 0,
              stepped: true,
            },
          ],
        },
        options: base,
      });
      make('ch-drawdown', {
        type: 'line',
        data: {
          labels: dates,
          datasets: [
            {
              label: 'Caída desde el máximo (%)',
              data: c['drawdownPct'],
              borderColor: this.css('--red'),
              backgroundColor: this.css('--red-soft'),
              fill: true,
              borderWidth: 1.5,
              pointRadius: 0,
            },
          ],
        },
        options: base,
      });
    }
    const hs = this.holdings();
    if (hs.length) {
      make('ch-weights', {
        type: 'bar',
        data: {
          labels: hs.map((h) => h['ticker']),
          datasets: [
            {
              label: 'Hoy (%)',
              data: hs.map((h) => h['weightPct']),
              backgroundColor: this.css('--brand'),
            },
            {
              label: 'Objetivo (%)',
              data: hs.map((h) => h['targetPct']),
              backgroundColor: this.css('--line-strong'),
            },
          ],
        },
        options: base,
      });
    }
  }
}
