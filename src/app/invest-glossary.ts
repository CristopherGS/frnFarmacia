export interface GlossaryEntry {
  key: string;
  title: string;
  text: string;
}

/** Explicaciones cortas y sin jerga para los términos que aparecen en el panel. */
export const GLOSSARY: GlossaryEntry[] = [
  {
    key: 'etf',
    title: 'ETF',
    text: 'Un fondo que se compra como una acción y que contiene muchas inversiones a la vez. Con una sola compra tienes un pedacito de cientos o miles de empresas o bonos. Es la forma más barata y simple de diversificar.',
  },
  {
    key: 'voo',
    title: 'VOO',
    text: 'ETF de Vanguard que replica el S&P 500: las 500 empresas más grandes de EE. UU. Es la parte de «crecimiento» de tu portafolio.',
  },
  {
    key: 'vxus',
    title: 'VXUS',
    text: 'ETF de Vanguard con empresas de todo el mundo menos EE. UU. Sirve para no depender de un solo país.',
  },
  {
    key: 'bnd',
    title: 'BND',
    text: 'ETF de Vanguard con bonos de EE. UU. Sube y baja menos que las acciones y amortigua las caídas, aunque en 2022 también cayó cuando subieron las tasas.',
  },
  {
    key: 'sgov',
    title: 'SGOV',
    text: 'ETF de letras del Tesoro de EE. UU. a muy corto plazo. Casi no se mueve y paga intereses: es tu «colchón» dentro del portafolio.',
  },
  {
    key: 'sp500',
    title: 'S&P 500',
    text: 'Índice de las 500 mayores empresas de EE. UU. Se usa como termómetro del mercado de acciones.',
  },
  {
    key: 'vix',
    title: 'VIX (índice del miedo)',
    text: 'Mide cuánta turbulencia espera el mercado en el próximo mes. Menos de 20 = calma, entre 20 y 30 = nervios, más de 30 = miedo. Sube cuando el mercado cae y baja cuando se calma.',
  },
  {
    key: 'drawdown',
    title: 'Caída desde el máximo (drawdown)',
    text: 'Cuánto está por debajo del punto más alto que alcanzó. Si el S&P llegó a 6000 y hoy está en 5400, la caída es −10%. No es una pérdida real hasta que vendes.',
  },
  {
    key: 'correccion',
    title: 'Corrección y mercado bajista',
    text: 'Corrección: caída de 10% o más desde el máximo. Mercado bajista: 20% o más. Crisis: 30% o más. Las correcciones ocurren más o menos una vez al año; los mercados bajistas, cada pocos años. Todos se han recuperado.',
  },
  {
    key: 'sma200',
    title: 'Media de 200 días (SMA200)',
    text: 'El promedio de los últimos 200 días de cierre. Si el precio está por encima, la tendencia es sana; si cae por debajo, suele indicar debilidad. No es una señal de venta para un plan a largo plazo, solo contexto.',
  },
  {
    key: 'curva',
    title: 'Curva de rendimientos',
    text: 'Diferencia entre lo que paga un bono a 10 años y uno a 2 años. Normalmente es positiva. Cuando se vuelve negativa («invertida») ha antecedido a varias recesiones, pero puede tardar uno o dos años en cumplirse y no es una señal de venta.',
  },
  {
    key: 'spread',
    title: 'Spread de bonos de alto riesgo',
    text: 'Extra que pagan las empresas más endeudadas para conseguir dinero. Si sube rápido, los inversionistas sienten más riesgo de que haya quiebras: es una señal de estrés financiero.',
  },
  {
    key: 'rebalanceo',
    title: 'Rebalanceo',
    text: 'Volver a los porcentajes de tu plan. Aquí se hace sin vender: tu próximo aporte se dirige a lo que quedó por debajo del objetivo, así no pagas comisiones ni impuestos.',
  },
  {
    key: 'banda',
    title: 'Banda de rebalanceo',
    text: 'Margen de tolerancia alrededor de cada porcentaje objetivo (por ejemplo ±5 puntos). Solo se actúa cuando un ETF sale de la banda; moverse por pequeñas diferencias es ruido.',
  },
  {
    key: 'volatilidad',
    title: 'Volatilidad',
    text: 'Qué tanto sube y baja el portafolio. Se mide como porcentaje anual: 15% significa que en un año típico puede moverse unos 15% hacia arriba o abajo del promedio.',
  },
  {
    key: 'sharpe',
    title: 'Sharpe',
    text: 'Cuánto rendimiento extra obtienes por cada unidad de riesgo, frente a un depósito sin riesgo. Más alto es mejor; por encima de 1 se considera bueno. Con poco historial es poco confiable.',
  },
  {
    key: 'beta',
    title: 'Beta',
    text: 'Qué tanto se mueve tu portafolio frente al S&P 500. Beta 1 = igual; 0.6 = se mueve más o menos el 60% de lo que se mueve el mercado.',
  },
  {
    key: 'prueba',
    title: 'Prueba de estrés',
    text: 'Una simulación: «si hoy ocurriera una crisis como la de 2008, 2020 o 2022, ¿cuánto bajaría mi portafolio?». Son estimaciones con caídas históricas aproximadas por tipo de activo, no predicciones.',
  },
  {
    key: 'dca',
    title: 'Aporte periódico (DCA)',
    text: 'Invertir el mismo monto cada mes, sin importar el precio. Compras más barato cuando el mercado cae y evitas intentar adivinar el mejor momento.',
  },
  {
    key: 'emergencia',
    title: 'Fondo de emergencia',
    text: 'Dinero líquido para imprevistos (idealmente 3 a 6 meses de gastos) que no está invertido en bolsa. Se arma antes de comprar más durante una caída para no tener que vender en el peor momento.',
  },
  {
    key: 'pani',
    title: 'No vender en pánico',
    text: 'Vender tras una caída convierte una pérdida en papel en una pérdida real y casi siempre significa perderse la recuperación. Los mejores días del mercado suelen llegar muy cerca de los peores.',
  },
  {
    key: 'twr',
    title: 'Rendimiento sin aportes',
    text: 'El cambio diario del portafolio sin contar el dinero que agregas, para que un aporte no parezca ganancia. Con esto se calculan volatilidad, caída máxima, Sharpe y beta.',
  },
];
