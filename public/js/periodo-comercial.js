/**
 * Mês comercial da rede: vai do dia 26 de um mês até o dia 25 do mês seguinte.
 *   - Hoje 25/10/2026 -> 26/09/2026 a 25/10/2026 (mês de outubro)
 *   - Hoje 28/10/2026 -> 26/10/2026 a 25/11/2026 (mês de novembro)
 * O "mês" (competência das metas) é o do dia 25, quando o período fecha.
 */

const DIA_FECHAMENTO = 25;

function isoData(ano, mes, dia) {          // mes: 1..12
  return `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

function somarMeses(ano, mes, n) {          // devolve [ano, mes] com mes 1..12
  const total = ano * 12 + (mes - 1) + n;
  return [Math.floor(total / 12), (total % 12) + 1];
}

/** Período comercial que contém a data (padrão: hoje). */
function periodoComercialDe(data = new Date()) {
  let ano = data.getFullYear();
  let mes = data.getMonth() + 1;
  // A partir do dia 26 já é o mês comercial seguinte
  if (data.getDate() > DIA_FECHAMENTO) [ano, mes] = somarMeses(ano, mes, 1);
  const [anoIni, mesIni] = somarMeses(ano, mes, -1);
  return {
    inicio: isoData(anoIni, mesIni, DIA_FECHAMENTO + 1),
    fim: isoData(ano, mes, DIA_FECHAMENTO),
    competencia: ano * 100 + mes
  };
}

/** Mês comercial (AAAAMM) de uma data ISO: dia 26 em diante conta para o mês seguinte. */
function competenciaComercial(dataISO, ehInicio) {
  const [a, m, d] = dataISO.split('-').map(Number);
  if (ehInicio && d > DIA_FECHAMENTO) {
    const [a2, m2] = somarMeses(a, m, 1);
    return a2 * 100 + m2;
  }
  return a * 100 + m;
}

/** Nome curto do período: "26/09 a 25/10" */
function rotuloPeriodo(inicioISO, fimISO) {
  const f = iso => { const [, m, d] = iso.split('-'); return `${d}/${m}`; };
  return `${f(inicioISO)} a ${f(fimISO)}`;
}

/**
 * Os N períodos que terminam no período informado (do mais antigo ao atual).
 * Se o período informado for um mês comercial (26 a 25), os anteriores também
 * serão; senão, cada período anterior é o mesmo intervalo recuado 1 mês.
 */
function periodosAnteriores(inicioISO, fimISO, n = 3) {
  const [ai, mi, di] = inicioISO.split('-').map(Number);
  const [af, mf, df] = fimISO.split('-').map(Number);
  const ultimoDia = (a, m) => new Date(a, m, 0).getDate();
  const lista = [];
  for (let k = n - 1; k >= 0; k--) {
    const [a1, m1] = somarMeses(ai, mi, -k);
    const [a2, m2] = somarMeses(af, mf, -k);
    const ini = isoData(a1, m1, Math.min(di, ultimoDia(a1, m1)));
    const fim = isoData(a2, m2, Math.min(df, ultimoDia(a2, m2)));
    lista.push({ inicio: ini, fim, rotulo: rotuloPeriodo(ini, fim), competencia: competenciaComercial(fim, false) });
  }
  return lista;
}

/** Preenche Data Inicial / Data Final com o mês comercial atual (se estiverem vazias). */
function preencherPeriodoPadrao() {
  const p = periodoComercialDe(new Date());
  const ini = document.getElementById('dataInicial');
  const fim = document.getElementById('dataFinal');
  if (ini && !ini.value) ini.value = p.inicio;
  if (fim && !fim.value) fim.value = p.fim;
}
