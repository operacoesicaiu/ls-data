import { listCredentials, requireCredentialStorage } from './credentials.js';
import { decryptVaultEntryFields } from './vault-entries.js';

export const DISPARO_LOG_PREFIX = 'disparo:logs:v1:';
const DISPARO_SETTINGS_PREFIX = 'disparo:settings:v1:';

export const DISPARO_COMPANIES = Object.freeze({
  icaiu: Object.freeze({
    id: 'icaiu',
    name: 'iCaiu',
    source: Object.freeze({ spreadsheetId: '1eejwXJU8lk56YykmdJ3GilQ5uWhhGp3GfHe8TyKda3Y', sheetId: 915077706 }),
  }),
  'loja-do-sapo': Object.freeze({
    id: 'loja-do-sapo',
    name: 'Loja do Sapo',
    source: Object.freeze({ spreadsheetId: '13Yd7Efc-2yUVBE71i4DDMV7SLSqU_Ftfss0AgJ5jo9o', sheetId: 1914931858 }),
  }),
});

export const DISPARO_OPTIONS = Object.freeze({
  dispositivos: ['TODOS', 'iPhone', 'Apple Watch', 'iPad', 'iMac', 'Macbook', 'Outros', 'N/D'],
  servicos: ['TODOS', 'Aparelho Inoperante', 'Aparelho inoperante', 'Bateria', 'Face ID', 'Outro problema', 'reparo em placa', 'Sistema / Lentidão', 'Tela Quebrada', 'Tela quebrada', 'Vidro Quebrado', 'Vidro Traseiro'],
  motivosContato: ['TODOS', 'Consertar aparelho', 'Sobre outro assunto', 'Exercer garantia', 'Proteger aparelho', 'Comprar aparelho', 'Vender aparelho', 'Serviço em andamento', 'Alteração no agendamento', 'Serviço que não realizamos'],
  estagios: ['TODOS', 'Aguardando Resposta - Gatilho', 'Qualificação'],
  setores: ['TODOS', 'Comercial'],
  removerAgendamento: ['TODOS', 'Sim', 'Não', 'N/D'],
  motivosNaoAgendamento: ['TODOS', 'Seviço Apple não realizado', 'Não precisou mais do serviço', 'Falta de disponibilidade do cliente', 'Autorizada Apple', 'Preço - Pesquisando', 'Prazo de entrega', 'Outras marcas', 'Localização', 'Preço - Achou caro', 'Preço - Queria original', 'Tratado em outra conversa', 'Foi em loja sem agendar', 'Preço - Falta de estoque', 'Falta de vaga na agenda', 'Preço - Sem dinheiro', 'Agendamento para mais de 10 dias', 'N/D'],
});

export const DISPARO_DEFAULTS = Object.freeze({
  dispositivos: ['iPhone'],
  servicos: ['TODOS'],
  motivosContato: ['Consertar aparelho'],
  estagios: ['TODOS'],
  setores: ['TODOS'],
  removerAgendamento: ['Sim'],
  motivosNaoAgendamento: ['Preço - Queria original', 'Preço - Sem dinheiro', 'Preço - Falta de estoque', 'Preço - Achou caro', 'Falta de disponibilidade do cliente', 'Preço - Pesquisando', 'Falta de vaga na agenda', 'Prazo de entrega', 'N/D'],
});

export const DISPARO_COMPANY_DEFAULTS = Object.freeze({
  icaiu: DISPARO_DEFAULTS,
  'loja-do-sapo': Object.freeze({ ...DISPARO_DEFAULTS, dispositivos: ['iPhone', 'iPad', 'Apple Watch'] }),
});

export function disparoDefaultsForCompany(companyId) {
  return DISPARO_COMPANY_DEFAULTS[companyId] || DISPARO_DEFAULTS;
}

const ICAIU_SOURCE = Object.freeze({
  spreadsheetId: '1eejwXJU8lk56YykmdJ3GilQ5uWhhGp3GfHe8TyKda3Y',
  sheetId: 915077706,
  columns: Object.freeze({
    data: 'B', dispositivo: 'F', servico: 'H', nome: 'I', motivoContato: 'Q',
    telefone: 'S', estagioId: 'AA', setorId: 'AK', agendamento: 'AV',
    listaAw: 'AW', telefoneFallback: 'BL',
  }),
});

const LOJA_DO_SAPO_SOURCE = Object.freeze({
  spreadsheetId: '13Yd7Efc-2yUVBE71i4DDMV7SLSqU_Ftfss0AgJ5jo9o',
  sheetId: 1914931858,
  columns: Object.freeze({
    data: 'B', dispositivo: 'F', servico: 'H', nome: 'I', motivoContato: 'Q',
    listId: 'E', finishedAt: 'N', customField1: 'F', customField2: 'G', customField3: 'H',
    telefone: 'S', telefoneFallback: 'T',
  }),
});

const APPOINTMENTS = Object.freeze({
  spreadsheetId: '1CcWajdGAXPtUtW490E-UWsbXOm87dPqACj5FDM8-zi4',
  erp: Object.freeze({ sheet: 'ERP', phone: 'A', date: 'R' }),
  faturamento: Object.freeze({ sheet: 'Faturamento', phone: 'A', date: 'D' }),
});

const NAME_TO_ID = new Map([
  ['aguardando resposta - gatilho', '67b88bc50e0b77b1c7b23837'],
  ['qualificacao', '679277fd88aa636b724c4b6a'],
  ['comercial', '679106653b58e512b9dc8678'],
]);
const ID_TO_NAME = new Map([
  ['67b88bc50e0b77b1c7b23837', 'Aguardando Resposta - Gatilho'],
  ['679277fd88aa636b724c4b6a', 'Qualificação'],
  ['679106653b58e512b9dc8678', 'Comercial'],
]);

const OUTPUT_HEADERS = ['Nome', 'Telefone', 'Data', 'Dispositivos', 'Serviços', 'Motivos de Contato', 'Estágios', 'Setores', 'Remover com Agendamento'];
const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';
const tokenCache = new Map();
const FALLBACK_SERVICE_ACCOUNT_EMAILS = new Set([
  'github-worker@automacao-github.iam.gserviceaccount.com',
]);

function text(value) { return value == null ? '' : String(value).trim(); }

export function normalizeDisparoValue(value) {
  return text(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function dayFromDateParts(year, month, day) {
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (date.getUTCFullYear() !== Number(year) || date.getUTCMonth() !== Number(month) - 1 || date.getUTCDate() !== Number(day)) return null;
  return Math.floor(date.getTime() / 86_400_000);
}

export function dateDay(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.floor(value - 25569);
  const source = text(value);
  let match = source.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (match) return dayFromDateParts(match[1], match[2], match[3]);
  match = source.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return match ? dayFromDateParts(match[3], match[2], match[1]) : null;
}

function formatDay(day) {
  const date = new Date(day * 86_400_000);
  return `${String(date.getUTCDate()).padStart(2, '0')}/${String(date.getUTCMonth() + 1).padStart(2, '0')}/${date.getUTCFullYear()}`;
}

function filter(values) {
  const normalized = (Array.isArray(values) ? values : [values]).map(normalizeDisparoValue).filter(Boolean);
  return {
    all: normalized.length === 0 || normalized.includes('todos'),
    nd: normalized.includes('n/d'),
    values: new Set(normalized.filter(value => value !== 'todos' && value !== 'n/d')),
  };
}

function passes(value, selected) {
  if (selected.all) return true;
  const current = normalizeDisparoValue(value);
  if (selected.nd && (!current || current === 'n/d')) return true;
  return selected.values.has(current);
}

function isValidPhone(value) {
  let digits = text(value).replace(/\D/g, '');
  if (digits.startsWith('55') && digits.length > 11) digits = digits.slice(2);
  return digits.length >= 10 && digits.length <= 11;
}

function passesAppointment(value, selected) {
  if (selected.all || selected.values.has('nao')) return true;
  const current = normalizeDisparoValue(value);
  if (selected.nd && selected.values.size === 0) return !current || current === 'n/d';
  if (selected.values.size === 1 && selected.values.has('sim')) return current !== 'sim';
  return true;
}

function phone(value) {
  let digits = text(value).replace(/\D/g, '');
  if (digits.startsWith('55') && digits.length > 11) digits = digits.slice(2);
  return digits;
}

function selectedIds(values, label) {
  const selected = filter(values);
  if (selected.all || selected.nd) return selected;
  const ids = new Set();
  for (const name of selected.values) {
    const id = NAME_TO_ID.get(name);
    if (!id) throw new Error(`Não encontrei o ID para ${label}: ${name}.`);
    ids.add(normalizeDisparoValue(id));
  }
  return { ...selected, values: ids };
}

export function buildDisparoBase({ sourceRows, erpRows, billingRows, startDate, endDate, filters, companyId = '' }) {
  const start = dateDay(startDate);
  const end = dateDay(endDate);
  if (start == null || end == null) throw new Error('Informe datas de início e fim válidas.');
  if (start > end) throw new Error('A data inicial não pode ser posterior à data final.');
  const chosen = {
    dispositivo: filter(filters.dispositivos),
    servico: filter(filters.servicos),
    motivoContato: filter(filters.motivosContato),
    estagioId: selectedIds(filters.estagios, 'estágio'),
    setorId: selectedIds(filters.setores, 'setor'),
    agendamento: filter(filters.removerAgendamento),
    listaAw: filter(filters.motivosNaoAgendamento),
  };
  const attended = { erp: new Set(), billing: new Set() };
  for (const item of erpRows || []) {
    const day = dateDay(item.date);
    if (day != null && day >= start && day <= end && phone(item.phone)) attended.erp.add(phone(item.phone));
  }
  for (const item of billingRows || []) {
    const day = dateDay(item.date);
    if (day != null && day >= start && day <= end && phone(item.phone)) attended.billing.add(phone(item.phone));
  }
  const uniquePhones = new Set();
  const isSapo = companyId === 'loja-do-sapo';
  const summary = { periodo: 0, comTelefone: 0, semTelefone: 0, telefoneFallbackUsado: 0, telefonesCampoDivergente: 0, aposErp: 0, aposFaturamento: 0, aposDispositivo: 0, aposServico: 0, aposMotivoContato: 0, aposEstagio: 0, aposSetor: 0, aposAgendamento: 0, aposMotivoNaoAgendamento: 0, antesDeduplicacao: 0, telefonesDuplicados: 0, telefonesUnicos: 0, ...(isSapo ? { filtroErpAplicavel: false, filtroFaturamentoAplicavel: false, filtroAgendamentoAplicavel: false, filtroMotivoNaoAgendamentoAplicavel: false } : {}) };
  const rows = [];
  for (const row of sourceRows || []) {
    const day = dateDay(row.data);
    if (day == null || day < start || day > end) continue;
    summary.periodo += 1;
    const originalPhone = text(row.telefone) ? row.telefone : row.telefoneFallback;
    const normalizedPhone = phone(originalPhone);
    if (!normalizedPhone) { summary.semTelefone += 1; continue; }
    summary.comTelefone += 1;
    if (isSapo && !text(row.telefone) && text(row.telefoneFallback)) summary.telefoneFallbackUsado += 1;
    if (isSapo && isValidPhone(row.telefone) && isValidPhone(row.telefoneFallback) && phone(row.telefone) !== phone(row.telefoneFallback)) summary.telefonesCampoDivergente += 1;
    if (attended.erp.has(normalizedPhone)) continue;
    summary.aposErp += 1;
    if (attended.billing.has(normalizedPhone)) continue;
    summary.aposFaturamento += 1;
    if (!passes(row.dispositivo, chosen.dispositivo)) continue;
    summary.aposDispositivo += 1;
    if (!passes(row.servico, chosen.servico)) continue;
    summary.aposServico += 1;
    if (!passes(row.motivoContato, chosen.motivoContato)) continue;
    summary.aposMotivoContato += 1;
    if (!passes(row.estagioId, chosen.estagioId)) continue;
    summary.aposEstagio += 1;
    if (!passes(row.setorId, chosen.setorId)) continue;
    summary.aposSetor += 1;
    if (!passesAppointment(row.agendamento, chosen.agendamento)) continue;
    summary.aposAgendamento += 1;
    if (!passes(row.listaAw, chosen.listaAw)) continue;
    summary.aposMotivoNaoAgendamento += 1;
    summary.antesDeduplicacao += 1;
    if (uniquePhones.has(normalizedPhone)) { summary.telefonesDuplicados += 1; continue; }
    uniquePhones.add(normalizedPhone);
    summary.telefonesUnicos += 1;
    rows.push([text(row.nome), text(originalPhone), formatDay(day), text(row.dispositivo), text(row.servico), text(row.motivoContato), ID_TO_NAME.get(normalizeDisparoValue(row.estagioId)) || text(row.estagioId), ID_TO_NAME.get(normalizeDisparoValue(row.setorId)) || text(row.setorId), text(row.agendamento)]);
  }
  return { headers: OUTPUT_HEADERS, rows, summary };
}

function base64Url(bytesOrText) {
  const bytes = typeof bytesOrText === 'string' ? new TextEncoder().encode(bytesOrText) : new Uint8Array(bytesOrText);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function pemBytes(pem) {
  const encoded = text(pem).replace(/\\n/g, '\n').replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, '');
  if (!encoded) throw new Error('A chave privada da conta de serviço está vazia.');
  try { return Uint8Array.from(atob(encoded), character => character.charCodeAt(0)); } catch (_) { throw new Error('A chave privada da conta de serviço é inválida.'); }
}

export function serviceAccountFromFields(fields) {
  const validPrivateKey = value => {
    const clean = text(value).replace(/\\n/g, '\n');
    const body = clean.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, '');
    return body.length >= 256 ? clean : '';
  };
  for (const field of fields || []) {
    try {
      const parsed = JSON.parse(text(field.value));
      const privateKey = validPrivateKey(parsed?.private_key);
      if (parsed?.client_email && privateKey) return { clientEmail: text(parsed.client_email), privateKey, tokenUri: 'https://oauth2.googleapis.com/token' };
    } catch (_) {}
  }
  const byLabel = new Map((fields || []).map(field => [normalizeDisparoValue(field.label), text(field.value)]));
  const find = (...names) => names.map(normalizeDisparoValue).map(name => byLabel.get(name)).find(Boolean) || '';
  const clientEmail = find('client_email', 'client email', 'google_client_email', 'google client email', 'e-mail da conta de serviço', 'email da conta de servico');
  const privateKey = validPrivateKey(find('private_key', 'private key', 'google_private_key', 'google private key', 'chave privada'));
  return clientEmail && privateKey ? { clientEmail, privateKey, tokenUri: 'https://oauth2.googleapis.com/token' } : null;
}

export async function findCompanyServiceAccounts(env, companyId) {
  const allRecords = await listCredentials(env);
  const records = allRecords.filter(record => record.scope === 'company' && record.companyId === companyId);
  const googleScore = record => Number(/google|service account|conta de servi/i.test(`${record.label} ${record.siteUrl}`));
  const googleFirst = [...records].sort((left, right) => googleScore(right) - googleScore(left));
  const keyMaterial = await requireCredentialStorage(env);
  const candidates = [];
  const seen = new Set();
  async function addRecord(record, fallback = false) {
    if (!record || seen.has(record.id)) return;
    seen.add(record.id);
    try {
      const fields = await decryptVaultEntryFields(record, keyMaterial);
      const account = serviceAccountFromFields(fields);
      if (account) candidates.push({ ...account, credentialId: record.id, credentialLabel: record.label, fallback });
    } catch (_) {}
  }
  for (const record of googleFirst) await addRecord(record);
  for (const record of allRecords.filter(record => /google|service account|conta de servi/i.test(`${record.label} ${record.siteUrl}`))) {
    if (seen.has(record.id)) continue;
    try {
      const fields = await decryptVaultEntryFields(record, keyMaterial);
      const account = serviceAccountFromFields(fields);
      if (account && FALLBACK_SERVICE_ACCOUNT_EMAILS.has(normalizeDisparoValue(account.clientEmail))) {
        seen.add(record.id);
        candidates.push({ ...account, credentialId: record.id, credentialLabel: record.label, fallback: true });
      }
    } catch (_) {}
  }
  if (candidates.length) return candidates;
  if (!records.length) throw new Error('Cadastre uma credencial Google para esta empresa em Senhas e chaves.');
  throw new Error('A credencial Google desta empresa não contém client_email e private_key de uma conta de serviço. Uma API key simples não permite ler as planilhas fonte.');
}

export async function findCompanyServiceAccount(env, companyId) {
  return (await findCompanyServiceAccounts(env, companyId))[0];
}

export async function googleAccessToken(account, fetchImpl = fetch) {
  const cached = tokenCache.get(account.clientEmail);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = base64Url(JSON.stringify({ iss: account.clientEmail, scope: GOOGLE_SCOPE, aud: account.tokenUri, iat: now, exp: now + 3600 }));
  const signingInput = `${header}.${claim}`;
  const key = await crypto.subtle.importKey('pkcs8', pemBytes(account.privateKey), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(signingInput));
  const response = await fetchImpl(account.tokenUri, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${signingInput}.${base64Url(signature)}` }) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) throw new Error(`O Google recusou a conta de serviço: ${payload.error_description || payload.error || `HTTP ${response.status}`}`);
  tokenCache.set(account.clientEmail, { token: payload.access_token, expiresAt: Date.now() + Math.max(60, Number(payload.expires_in) || 3600) * 1000 });
  return payload.access_token;
}

function quotedSheet(title) { return `'${String(title).replace(/'/g, "''")}'`; }

async function googleJson(url, token, options = {}, fetchImpl = fetch) {
  const response = await fetchImpl(url, { ...options, headers: { Authorization: `Bearer ${token}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message || `Google Sheets respondeu HTTP ${response.status}.`);
  return payload;
}

async function sheetTitle(spreadsheetId, sheetId, token, fetchImpl) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=sheets.properties(sheetId,title)`;
  const payload = await googleJson(url, token, {}, fetchImpl);
  const match = (payload.sheets || []).find(sheet => Number(sheet?.properties?.sheetId) === Number(sheetId));
  if (!match) throw new Error(`A aba gid=${sheetId} não foi encontrada.`);
  return match.properties.title;
}

async function batchColumns(spreadsheetId, title, columns, token, fetchImpl) {
  const query = columns.map(column => `ranges=${encodeURIComponent(`${quotedSheet(title)}!${column}2:${column}`)}`).join('&');
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values:batchGet?majorDimension=ROWS&valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER&${query}`;
  const payload = await googleJson(url, token, {}, fetchImpl);
  return columns.map((_, index) => (payload.valueRanges?.[index]?.values || []).map(row => row?.[0] ?? ''));
}

function rowsFromColumns(keys, columns) {
  const length = Math.max(0, ...columns.map(column => column.length));
  return Array.from({ length }, (_, row) => Object.fromEntries(keys.map((key, index) => [key, columns[index][row] ?? ''])));
}

export async function readDisparoSources(company, token, fetchImpl = fetch) {
  if (!company?.source?.spreadsheetId || !company?.source?.sheetId) throw new Error('A empresa nÃ£o possui uma fonte de dados configurada.');
  const { spreadsheetId, sheetId } = company.source;
  const title = await sheetTitle(spreadsheetId, sheetId, token, fetchImpl);
  if (company.id === 'loja-do-sapo') {
    const keys = Object.keys(LOJA_DO_SAPO_SOURCE.columns);
    const columns = await batchColumns(spreadsheetId, title, keys.map(key => LOJA_DO_SAPO_SOURCE.columns[key]), token, fetchImpl);
    const sourceRows = rowsFromColumns(keys, columns).map(row => ({
      ...row,
      // The current ls-data card schema stores customer contact data in its custom fields.
      telefone: row.telefone,
      telefoneFallback: [row.telefoneFallback, row.customField1, row.customField2, row.customField3].find(value => {
        const digits = text(value).replace(/\D/g, '');
        return digits.length >= 10 && digits.length <= 13;
      }) || '',
      estagioId: row.listId,
      setorId: '',
      agendamento: '',
      listaAw: '',
    }));
    const total = sourceRows.length;
    const finishedRows = sourceRows.filter(row => Boolean(text(row.finishedAt)));
    const targetListRows = finishedRows.filter(row => text(row.listId) === '684b0513919fd2dca2e5f343');
    return {
      sourceRows: targetListRows,
      erpRows: [],
      billingRows: [],
      sourceSummary: {
        totalFonte: total,
        aposFinishedAt: finishedRows.length,
        antesFiltroList: finishedRows.length,
        aposFiltroList: targetListRows.length,
      },
      accesses: [{ name: 'Omnichannel Hablla Card', status: 'success', rows: total }],
    };
  }

  const keys = Object.keys(ICAIU_SOURCE.columns);
  const [columns, appointmentColumns, billingColumns] = await Promise.all([
    batchColumns(spreadsheetId, title, keys.map(key => ICAIU_SOURCE.columns[key]), token, fetchImpl),
    batchColumns(APPOINTMENTS.spreadsheetId, APPOINTMENTS.erp.sheet, [APPOINTMENTS.erp.phone, APPOINTMENTS.erp.date], token, fetchImpl),
    batchColumns(APPOINTMENTS.spreadsheetId, APPOINTMENTS.faturamento.sheet, [APPOINTMENTS.faturamento.phone, APPOINTMENTS.faturamento.date], token, fetchImpl),
  ]);
  const sourceRows = rowsFromColumns(keys, columns);
  const erpRows = rowsFromColumns(['phone', 'date'], appointmentColumns);
  const billingRows = rowsFromColumns(['phone', 'date'], billingColumns);
  return {
    sourceRows,
    erpRows,
    billingRows,
    accesses: [
      { name: 'Base Hablla Card iCaiu', status: 'success', rows: sourceRows.length },
      { name: 'ERP iCaiu', status: 'success', rows: erpRows.length },
      { name: 'Faturamento iCaiu', status: 'success', rows: billingRows.length },
    ],
  };
}

export function validateDisparoRequest(body) {
  const company = DISPARO_COMPANIES[text(body?.companyId)];
  if (!company) return { error: 'Empresa inválida.' };
  const start = dateDay(body?.startDate); const end = dateDay(body?.endDate);
  if (start == null || end == null) return { error: 'Informe datas de início e fim válidas.' };
  if (start > end) return { error: 'A data inicial não pode ser posterior à data final.' };
  const filters = {};
  for (const [key, allowed] of Object.entries(DISPARO_OPTIONS)) {
    const companyDefaults = disparoDefaultsForCompany(company.id);
    const values = Array.isArray(body?.filters?.[key]) ? body.filters[key].map(text).filter(Boolean) : [...companyDefaults[key]];
    if (!values.length || values.length > allowed.length || values.some(value => !allowed.includes(value))) return { error: `Filtro ${key} inválido.` };
    filters[key] = values.includes('TODOS') ? ['TODOS'] : [...new Set(values)];
  }
  return { company, startDate: text(body.startDate), endDate: text(body.endDate), filters };
}

function settingsKey(companyId, actor) {
  return `${DISPARO_SETTINGS_PREFIX}${companyId}:${encodeURIComponent(String(actor || 'admin'))}`;
}

export async function readDisparoSettings(env, actor) {
  const result = {};
  for (const companyId of Object.keys(DISPARO_COMPANIES)) {
    try {
      const raw = await env.AUTH_DATA.get(settingsKey(companyId, actor));
      const parsed = raw ? JSON.parse(raw) : null;
      const validated = validateDisparoRequest({ companyId, ...parsed });
      if (!validated.error) result[companyId] = { startDate: validated.startDate, endDate: validated.endDate, filters: validated.filters, updatedAt: Number(parsed.updatedAt || 0) };
    } catch (_) {}
  }
  return result;
}

export async function saveDisparoSettings(env, actor, body) {
  const validated = validateDisparoRequest(body);
  if (validated.error) return validated;
  const stored = { startDate: validated.startDate, endDate: validated.endDate, filters: validated.filters, updatedAt: Date.now() };
  await env.AUTH_DATA.put(settingsKey(validated.company.id, actor), JSON.stringify(stored));
  return { company: validated.company, settings: stored };
}

export function disparoDownloadFileName(company, timestamp = Date.now()) {
  const date = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' })
    .format(new Date(timestamp)).replace(/\D/g, '');
  return `Base Disparo - ${company.name} - ${date}.xls`;
}

export async function appendDisparoLog(env, log) {
  const stored = { id: crypto.randomUUID(), ...log };
  const reverseTimestamp = String(9_999_999_999_999 - Number(stored.startedAt || Date.now())).padStart(13, '0');
  await env.AUTH_DATA.put(`${DISPARO_LOG_PREFIX}${stored.companyId}:${reverseTimestamp}:${stored.id}`, JSON.stringify(stored), { expirationTtl: 180 * 24 * 60 * 60 });
  return stored;
}

export async function listDisparoLogs(env, limitPerCompany = 20) {
  const result = {};
  for (const companyId of Object.keys(DISPARO_COMPANIES)) {
    const page = await env.AUTH_DATA.list({ prefix: `${DISPARO_LOG_PREFIX}${companyId}:`, limit: limitPerCompany });
    const logs = [];
    for (const key of page.keys || []) {
      const raw = await env.AUTH_DATA.get(key.name);
      try { if (raw) logs.push(JSON.parse(raw)); } catch (_) {}
    }
    result[companyId] = logs.sort((left, right) => Number(right.startedAt) - Number(left.startedAt)).slice(0, limitPerCompany);
  }
  return result;
}

export function publicCompanyConfig(company, configured = false) {
  return { id: company.id, name: company.name, credentialConfigured: configured };
}
