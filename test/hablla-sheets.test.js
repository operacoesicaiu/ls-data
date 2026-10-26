const test = require('node:test');
const assert = require('node:assert/strict');

const { uniqueAttendantRows } = require('../src/hablla/sheets/sync');
const {
  assertEmptyAttendantDaysAreSafe,
  booleanOption,
  buildCardSheet,
  collectCardSnapshots,
  completedDayRanges,
  discoverCardHeaders,
  enrichCardPhones,
  fetchPeopleForRange,
  fetchPeopleForCardWindow,
  personDateRanges,
  selectedDatasets,
  shouldReplaceCardRow,
  CARD_HEADERS,
  PHONE_HEADERS,
} = require('../src/hablla/sheets/sync')._internals;

function row({ date = '13/07/2026', sector = 'sector', user = 'user', connection = 'connection', total = 1 }) {
  const values = Array(17).fill('');
  values[0] = date;
  values[2] = sector;
  values[4] = user;
  values[7] = total;
  values[10] = connection;
  return values;
}

test('atendentes repetidos conservam somente a leitura mais recente', () => {
  const result = uniqueAttendantRows([row({ total: 1 }), row({ total: 2 })]);
  assert.equal(result.length, 1);
  assert.equal(result[0][7], 2);
});

test('linha sem identidade estável só é removida quando é cópia exata', () => {
  const first = row({ user: '', total: 1 });
  const changed = row({ user: '', total: 2 });
  assert.equal(uniqueAttendantRows([first, changed, [...changed]]).length, 2);
});

test('dia vazio de atendentes nunca remove linhas que ja existem', () => {
  assert.doesNotThrow(() =>
    assertEmptyAttendantDaysAreSafe(['12/07/2026'], [['11/07/2026']]),
  );
  assert.throws(
    () => assertEmptyAttendantDaysAreSafe(['12/07/2026'], [['12/07/2026']]),
    /1 dias que ja possuem linhas/,
  );
});

test('janela de cards usa created_at e preserva card antigo atualizado recentemente', () => {
  const cutoff = '2026-07-07';
  const oldCreatedRecentlyUpdated = Array(18).fill('');
  oldCreatedRecentlyUpdated[0] = '14/07/2026 10:00:00';
  oldCreatedRecentlyUpdated[1] = '01/06/2026 10:00:00';
  oldCreatedRecentlyUpdated[14] = 'old-card';

  const recentlyCreated = [...oldCreatedRecentlyUpdated];
  recentlyCreated[0] = '01/06/2026 10:00:00';
  recentlyCreated[1] = '14/07/2026 10:00:00';
  recentlyCreated[14] = 'new-card';

  assert.equal(
    shouldReplaceCardRow(oldCreatedRecentlyUpdated, new Set(), cutoff),
    false,
  );
  assert.equal(shouldReplaceCardRow(recentlyCreated, new Set(), cutoff), true);
  assert.equal(
    shouldReplaceCardRow(oldCreatedRecentlyUpdated, new Set(['old-card']), cutoff),
    true,
  );
  assert.equal(
    shouldReplaceCardRow(recentlyCreated, new Set(), cutoff, {
      preserveUnfetched: true,
    }),
    false,
  );
});

test('opcoes locais selecionam datasets e dias concluidos com validacao estrita', () => {
  assert.equal(booleanOption('sim', false, 'FLAG'), true);
  assert.equal(booleanOption('false', true, 'FLAG'), false);
  assert.throws(() => booleanOption('talvez', false, 'FLAG'), /true ou false/);
  assert.deepEqual([...selectedDatasets('cards')], ['cards']);
  assert.throws(() => selectedDatasets('clients'), /cards e attendants/);
  const ranges = completedDayRanges(3);
  assert.equal(ranges.length, 3);
  assert.ok(ranges[0].day < ranges[1].day);
  assert.ok(ranges[1].day < ranges[2].day);
});

test('coletas repetidas consolidam a versao mais recente por ID', async () => {
  let call = 0;
  const cards = await collectCardSnapshots({
    hablla: {},
    workspaceId: 'workspace',
    boardId: 'board',
    cutoff: '2026-07-01T03:00:00.000Z',
    exhaustive: true,
    passes: 2,
    attempts: 1,
    collect: async () => {
      call += 1;
      return call === 1
        ? [{ id: 'card-1', updated_at: '2026-07-10T10:00:00.000Z' }]
        : [
            { id: 'card-1', updated_at: '2026-07-10T11:00:00.000Z', status: 'novo' },
            { id: 'card-2', updated_at: '2026-07-10T12:00:00.000Z' },
          ];
    },
  });

  assert.equal(cards.length, 2);
  assert.equal(cards.find(({ id }) => id === 'card-1').status, 'novo');
});

test('telefone vem primeiro entre colunas novas e os campos extras sao descobertos', () => {
  const cards = [{
    id: 'card-1',
    updated_at: '2026-09-28T12:00:00.000Z',
    created_at: '2026-09-01T12:00:00.000Z',
    phone: '+5531999998888',
    custom_fields: [
      { custom_field: '69e8d49592607a5877e699d5', value: '31988887777' },
      { custom_field: 'custom-extra-id', value: 'extra-value' },
    ],
    source_detail: 'landing page',
  }];
  const currentHeader = [...CARD_HEADERS, 'existing-extra'];
  const discovered = discoverCardHeaders(cards, currentHeader);

  assert.deepEqual(discovered.slice(0, currentHeader.length), currentHeader);
  assert.deepEqual(discovered.slice(currentHeader.length, currentHeader.length + 2), PHONE_HEADERS);
  assert.ok(discovered.includes('card.source_detail'));
  assert.ok(discovered.includes('custom_field.custom-extra-id'));
});

test('linhas escrevem os dois telefones e preservam o cabecalho existente', () => {
  const cards = [{
    id: 'card-2',
    updated_at: '2026-09-28T12:00:00.000Z',
    created_at: '2026-09-01T12:00:00.000Z',
    phone: '+5531999998888',
    custom_fields: [
      { custom_field: '69e8d49592607a5877e699d5', value: '31988887777' },
      { custom_field: 'custom-extra-id', value: 'extra-value' },
    ],
    source_detail: 'landing page',
  }];
  const currentHeader = [...CARD_HEADERS, 'existing-extra'];
  const { header, rows } = buildCardSheet(cards, currentHeader);

  assert.deepEqual(header.slice(0, currentHeader.length), currentHeader);
  assert.equal(rows[0][currentHeader.length], '+5531999998888');
  assert.equal(rows[0][currentHeader.length + 1], '31988887777');
  assert.equal(rows[0][header.indexOf('card.source_detail')], 'landing page');
  assert.equal(rows[0][header.indexOf('custom_field.custom-extra-id')], 'extra-value');
  assert.equal(rows[0].length, header.length);
});

test('mapeia telefone da lista paginada de pessoas para o card sem chamadas individuais', async () => {
  const cards = [
    { id: 'card-1', persons: '["person-1"]', custom_fields: [] },
    { id: 'card-2', persons: ['person-1'], custom_fields: [] },
    { id: 'card-3', persons: [{ id: 'person-2' }], phone: '+5511999998888' },
  ];
  const people = [
    { id: 'person-1', phones: [{ phone: '+55 31 98888-7777', is_whatsapp: true }] },
    { id: 'person-2', phones: [{ phone: '+55 11 99999-8888' }] },
  ];
  const summary = enrichCardPhones(cards, people);

  assert.equal(cards[0].phone, '+55 31 98888-7777');
  assert.equal(cards[1].phone, '+55 31 98888-7777');
  assert.equal(cards[2].phone, '+5511999998888');
  const { header, rows } = buildCardSheet(cards, CARD_HEADERS);
  assert.equal(rows[0][header.indexOf('Telefone')], '+55 31 98888-7777');
  assert.equal(rows[1][header.indexOf('Telefone')], '+55 31 98888-7777');
  assert.deepEqual(summary, { people: 2, peopleWithPhone: 2, linkedPeopleMissing: 0, cardsWithPhone: 3 });
});

test('lista pessoas de forma paginada como o fluxo icaiu-data e respeita populate', async () => {
  const calls = [];
  const firstPage = Array.from({ length: 50 }, (_, index) => ({ id: `person-${index}`, created_at: '2026-09-01', updated_at: '2026-09-01' }));
  const lastPage = [{ id: 'person-50', created_at: '2026-10-01', updated_at: '2026-10-02', phones: [{ phone: '+55 31 98888-7777' }] }];
  const people = await fetchPeopleForRange({
    get: async (path, options) => {
      calls.push({ path, params: options.params });
      return { data: { results: options.params.page === 1 ? firstPage : lastPage } };
    },
  }, 'workspace', { start: '2026-08-28', end: '2026-10-26' });

  assert.equal(people.length, 51);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], {
    path: '/v1/workspaces/workspace/persons',
    params: {
      start_date: '2026-08-28', end_date: '2026-10-26', page: 1,
      limit: 50, field_date: 'created_at', populate: true,
    },
  });
});

test('pessoas sao consultadas em janelas diarias, do corte de 60 dias ate agora', () => {
  const now = new Date('2026-10-26T15:00:00.000Z');
  const ranges = personDateRanges(60, now);
  assert.equal(ranges.length, 61);
  assert.equal(ranges[0].start, '2026-08-27T03:00:00.000Z');
  assert.equal(ranges[0].end, '2026-08-28T02:59:59.999Z');
  assert.equal(ranges.at(-1).start, '2026-10-26T03:00:00.000Z');
  assert.equal(ranges.at(-1).end, '2026-10-26T15:00:00.000Z');
});

test('janela de cards busca pessoas por dia e consolida IDs repetidos', async () => {
  const requestedRanges = [];
  const people = await fetchPeopleForCardWindow({
    get: async (_path, { params }) => {
      requestedRanges.push([params.start_date, params.end_date]);
      return { data: { results: requestedRanges.length === 1
        ? [{ id: 'person-1', created_at: '2026-08-27', updated_at: '2026-08-27', phones: [] }]
        : requestedRanges.length === 2
          ? [{ id: 'person-1', created_at: '2026-08-27', updated_at: '2026-10-01', phones: [{ phone: '+5531999998888' }] }]
          : [] } };
    },
  }, 'workspace', 2, new Date('2026-10-26T15:00:00.000Z'));

  assert.equal(requestedRanges.length, 3);
  assert.equal(people.length, 1);
  assert.equal(people[0].updated_at, '2026-10-01');
  assert.equal(people[0].phones[0].phone, '+5531999998888');
});

test('contabiliza card cujo ID nao veio na janela de pessoas e nao inventa telefone', () => {
  const cards = [{ id: 'card-1', persons: ['older-person'] }];
  const summary = enrichCardPhones(cards, []);
  assert.equal(cards[0].phone, undefined);
  assert.deepEqual(summary, { people: 0, peopleWithPhone: 0, linkedPeopleMissing: 1, cardsWithPhone: 0 });
});
