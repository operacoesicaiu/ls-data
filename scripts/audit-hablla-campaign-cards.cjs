const getHabllaClient = require("../src/hablla/api");
const collectHabllaCards = require("../src/hablla/card-collector");
const axios = require("axios");
const { getGoogleAccessToken } = require("../src/google/auth");
const saoPauloDayRange = require("../src/hablla/date-range");
const { pathToFileURL } = require("node:url");
let buildDisparoBasePromise;

async function getBuildDisparoBase() {
  if (!buildDisparoBasePromise) {
    const modulePath = process.env.NEXUS_DISPARO_MODULE || `${process.cwd()}/scripts/nexus-disparo-source.mjs`;
    buildDisparoBasePromise = import(pathToFileURL(modulePath).href).then((module) => module.buildDisparoBase);
  }
  return buildDisparoBasePromise;
}

const CAMPAIGN_LIST = "6a873ec8a02f500d3ab0f07f";
const SAPO_DISPARO_LIST = "684b0513919fd2dca2e5f343";
const PHONE_FIELD = "69e8d49592607a5877e699d5";
const CAMPAIGN_TAGS = new Set(["683734fe6bf0b4e6f3565fe1", "683736f993808f81627b3f01"]);

function listId(value) {
  if (typeof value === "string" || typeof value === "number") return String(value);
  return String(value?.id || value?._id || "");
}

function tagIds(card) {
  return (Array.isArray(card.tags) ? card.tags : []).map((tag) =>
    typeof tag === "string" ? tag : String(tag?.id || tag?._id || ""),
  );
}

function sheetSerialDay(value) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.floor(value);
  const text = String(value || "").trim();
  const br = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  const parts = br
    ? [Number(br[3]), Number(br[2]), Number(br[1])]
    : iso ? [Number(iso[1]), Number(iso[2]), Number(iso[3])]
    : /^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2}$/.test(text)
      ? [Number(text.slice(6, 10)), Number(text.slice(3, 5)), Number(text.slice(0, 2))]
      : null;
  if (!parts) return null;
  const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  if (date.getUTCFullYear() !== parts[0] || date.getUTCMonth() !== parts[1] - 1 || date.getUTCDate() !== parts[2]) return null;
  return Math.floor(date.getTime() / 86_400_000) + 25569;
}

async function main() {
  const fromDate = process.env.AUDIT_FROM_DATE || "2026-09-28";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate)) throw new Error("AUDIT_FROM_DATE invalida");
  const cutoff = new Date(saoPauloDayRange(0, new Date(`${fromDate}T12:00:00.000Z`)).start);
  const now = new Date();
  if (!Number.isFinite(cutoff.getTime()) || cutoff > now) throw new Error("Janela da auditoria invalida");

  const hablla = await getHabllaClient();
  const cards = await collectHabllaCards({
    hablla,
    workspaceId: process.env.HABLLA_WORKSPACE_ID,
    boardId: process.env.HABLLA_BOARD_ID,
    cutoff: cutoff.toISOString(),
    exhaustive: false,
    pagesWithoutRecentCreated: 2,
  });

  const sheetId = process.env.HABLLA_SPREADSHEET_ID;
  if (!sheetId) throw new Error("HABLLA_SPREADSHEET_ID ausente");
  const googleToken = await getGoogleAccessToken();
  const ranges = ["'Base Hablla Card'!B2:B", "'Base Hablla Card'!C2:C", "'Base Hablla Card'!E2:E", "'Base Hablla Card'!F2:F", "'Base Hablla Card'!G2:G", "'Base Hablla Card'!H2:H", "'Base Hablla Card'!I2:I", "'Base Hablla Card'!J2:J", "'Base Hablla Card'!N2:N", "'Base Hablla Card'!O2:O", "'Base Hablla Card'!Q2:Q", "'Base Hablla Card'!S2:S", "'Base Hablla Card'!T2:T"];
  const query = new URLSearchParams({ majorDimension: "ROWS", valueRenderOption: "UNFORMATTED_VALUE", dateTimeRenderOption: "SERIAL_NUMBER" });
  for (const range of ranges) query.append("ranges", range);
  const sheetResponse = await axios.get(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values:batchGet?${query.toString()}`,
    {
      headers: { Authorization: `Bearer ${googleToken}` },
      timeout: 60000,
    },
  );
  const sheetColumns = ranges.map((_, index) => (sheetResponse.data?.valueRanges?.[index]?.values || []).map((row) => row?.[0] ?? ""));
  const sheetRowCount = Math.max(0, ...sheetColumns.map((column) => column.length));
  const sheetCards = [];
  const sheetIdCounts = new Map();
  const sheetColumnsByName = new Map(ranges.map((range, index) => [range.match(/!([A-Z]+)2:/)[1], index]));
  const sheetColumn = (letter, index) => sheetColumns[sheetColumnsByName.get(letter)]?.[index] ?? "";
  let sheetDateParsed = 0;
  for (let index = 0; index < sheetRowCount; index += 1) {
    const cardId = String(sheetColumn("O", index) || "").trim();
    if (!cardId) continue;
    sheetIdCounts.set(cardId, (sheetIdCounts.get(cardId) || 0) + 1);
    const createdDay = sheetSerialDay(sheetColumn("B", index));
    if (createdDay != null) sheetDateParsed += 1;
    const fallback = [sheetColumn("T", index), sheetColumn("F", index), sheetColumn("G", index), sheetColumn("H", index)].find((value) => {
      const digits = String(value || "").replace(/\D/g, "");
      return digits.length >= 10 && digits.length <= 13;
    }) || "";
    sheetCards.push({
      id: cardId,
      createdDay,
      updatedDay: sheetSerialDay(sheetColumn("C", index)),
      list: String(sheetColumn("E", index) || "").trim(),
      customPhone: fallback,
      customField1: String(sheetColumn("F", index) || ""),
      customField2: String(sheetColumn("G", index) || ""),
      customField3: String(sheetColumn("H", index) || ""),
      device: String(sheetColumn("F", index) || ""),
      service: String(sheetColumn("G", index) || ""),
      description: String(sheetColumn("J", index) || ""),
      contactReason: String(sheetColumn("Q", index) || ""),
      name: String(sheetColumn("I", index) || ""),
      finishedAt: sheetColumn("N", index),
      phone: String(sheetColumn("S", index) || ""),
    });
  }

  const byList = new Map();
  let campaignName = 0;
  let discountCardName = 0;
  let campaignList = 0;
  let sapoDisparoList = 0;
  let campaignTag = 0;
  let campaignTagFirst = 0;
  let campaignTagSecond = 0;
  let sapoCampaignName = 0;
  let sapoCampaignFinished = 0;
  let sapoCampaignWindow = 0;
  let sapoCampaignWithPhone = 0;
  let finished = 0;
  let withPhone = 0;
  const phoneFieldId = "69e8d49592607a5877e699d5";

  for (const card of cards) {
    const currentList = listId(card.list);
    byList.set(currentList || "(sem lista)", (byList.get(currentList || "(sem lista)") || 0) + 1);
    const name = String(card.name || "");
    if (/(disparo|marketing|promo|campanha)/i.test(name)) campaignName += 1;
    if (/ativo de desconto/i.test(name)) discountCardName += 1;
    if (currentList === CAMPAIGN_LIST) campaignList += 1;
    if (currentList === SAPO_DISPARO_LIST) sapoDisparoList += 1;
    const currentTags = tagIds(card);
    if ([...CAMPAIGN_TAGS].some((id) => currentTags.includes(id))) campaignTag += 1;
    if (currentTags.includes("683734fe6bf0b4e6f3565fe1")) campaignTagFirst += 1;
    if (currentTags.includes("683736f993808f81627b3f01")) campaignTagSecond += 1;
    if (card.finished_at) finished += 1;
    const customPhone = (card.custom_fields || []).some((field) =>
      String(field?.custom_field?.id || field?.custom_field || "") === phoneFieldId
      && /\d{10,}/.test(String(field.value || "")),
    );
    const cardPhone = /\d{10,}/.test(String(card.phone || ""));
    if (customPhone || cardPhone) withPhone += 1;
    if (currentList === SAPO_DISPARO_LIST && /ativo de desconto/i.test(name)) {
      sapoCampaignName += 1;
      if (card.finished_at) sapoCampaignFinished += 1;
      if (Date.parse(card.created_at) >= cutoff.getTime()) sapoCampaignWindow += 1;
      if (customPhone || cardPhone) sapoCampaignWithPhone += 1;
    }
  }

  const largestLists = [...byList.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 12)
    .map(([id, count]) => ({ id, count }));

  const cutoffDay = Math.floor(cutoff.getTime() / 86_400_000) + 25569;
  const apiCardsById = new Map(cards.map((card) => [String(card.id), card]));
  const sheetCardsInWindow = sheetCards.filter((card) => card.createdDay != null && card.createdDay >= cutoffDay);
  const sheetCardsInWindowById = new Map(sheetCardsInWindow.map((card) => [card.id, card]));
  const matchedIds = [...apiCardsById.keys()].filter((id) => sheetIdCounts.has(id));
  const duplicatedSheetRows = [...sheetIdCounts.values()].reduce((total, count) => total + Math.max(0, count - 1), 0);
  const sheetCampaignList = sheetCardsInWindow.filter((card) => card.list === CAMPAIGN_LIST).length;
  const sheetSapoList = sheetCardsInWindow.filter((card) => card.list === SAPO_DISPARO_LIST).length;
  const sheetFinishedInWindow = sheetCardsInWindow.filter((card) => card.finishedAt !== "").length;
  const sheetSapoCampaign = sheetCardsInWindow.filter((card) => card.list === SAPO_DISPARO_LIST && /ativo de desconto/i.test(card.name));
  const sheetSapoCampaignPhone = sheetSapoCampaign.filter((card) => /\d{10,}/.test(`${card.phone} ${card.customPhone}`)).length;
  const apiSapoListWindow = cards.filter((card) => listId(card.list) === SAPO_DISPARO_LIST && card.created_at >= cutoff.toISOString());
  const apiSapoListFinishedWindow = apiSapoListWindow.filter((card) => Boolean(card.finished_at));
  const apiSapoListFinishedNameWindow = apiSapoListFinishedWindow.filter((card) => /ativo de desconto/i.test(String(card.name || "")));
  const apiSapoListFinishedNameWindowWithSheetPhone = apiSapoListFinishedNameWindow.filter((card) => {
    const row = sheetCards.find((candidate) => candidate.id === String(card.id));
    return row && /\d{10,}/.test(`${row.phone} ${row.customPhone}`);
  }).length;
  const sheetOnlyIds = sheetCardsInWindow.filter((card) => !apiCardsById.has(card.id));
  const apiIdsInSheetWhole = [...apiCardsById.keys()].filter((id) => sheetIdCounts.has(id)).length;
  const historicLog = JSON.parse(process.env.NEXUS_DISPARO_LOG || "{}");
  const buildDisparoBase = await getBuildDisparoBase();
  const filters = historicLog.filters || {
    dispositivos: ["iPhone"], servicos: ["TODOS"], motivosContato: ["Consertar aparelho"],
    estagios: ["TODOS"], setores: ["TODOS"], removerAgendamento: ["Sim"],
    motivosNaoAgendamento: ["Falta de disponibilidade do cliente", "Pre?o - Pesquisando", "Prazo de entrega", "Localiza??o", "Pre?o - Achou caro", "Pre?o - Queria original", "Pre?o - Falta de estoque", "Falta de vaga na agenda", "Pre?o - Sem dinheiro", "Agendamento para mais de 10 dias", "N/D"],
  };
  const nexusRowsFromSheet = sheetCardsInWindow
    .filter((card) => card.list === SAPO_DISPARO_LIST && String(card.finishedAt || "").trim())
    .map((card) => ({ data: card.createdDay, dispositivo: card.device, servico: card.service, motivoContato: card.contactReason, estagioId: card.list, setorId: "", agendamento: "", listaAw: "", nome: card.name, telefone: card.phone, telefoneFallback: card.customPhone }));
  const sheetFunnel = buildDisparoBase({ sourceRows: nexusRowsFromSheet, erpRows: [], billingRows: [], startDate: fromDate, endDate: process.env.AUDIT_END_DATE || "2026-10-26", filters, companyId: "loja-do-sapo" });
  const apiEnd = new Date(saoPauloDayRange(0, new Date(`${process.env.AUDIT_END_DATE || "2026-10-26"}T12:00:00.000Z`)).end);
  const apiRowsForNexus = cards
    .filter((card) => Date.parse(card.created_at) >= cutoff.getTime() && Date.parse(card.created_at) <= apiEnd.getTime() && Boolean(card.finished_at) && listId(card.list) === SAPO_DISPARO_LIST)
    .map((card) => {
      const sheet = sheetCards.find((item) => item.id === String(card.id));
      const phoneField = (card.custom_fields || []).find((field) => String(field?.custom_field?.id || field?.custom_field || "") === PHONE_FIELD)?.value || "";
      const fallback = [sheet?.customPhone, phoneField, card.phone].find((value) => {
        const digits = String(value || "").replace(/\D/g, "");
        return digits.length >= 10 && digits.length <= 13;
      }) || "";
      return { data: card.created_at, dispositivo: sheet?.device || "", servico: sheet?.service || "", motivoContato: "", estagioId: SAPO_DISPARO_LIST, setorId: "", agendamento: "", listaAw: "", nome: card.name || "", telefone: sheet?.phone || card.phone || "", telefoneFallback: fallback };
    });
  const apiFunnel = buildDisparoBase({ sourceRows: apiRowsForNexus, erpRows: [], billingRows: [], startDate: fromDate, endDate: process.env.AUDIT_END_DATE || "2026-10-26", filters, companyId: "loja-do-sapo" });
  console.log(JSON.stringify({
    audit: "read-only Hablla card count; no sheet writes",
    sheetDateParsed,
    sheetCreationDateMinDay: sheetCards.reduce((min, card) => card.createdDay == null ? min : Math.min(min, card.createdDay), Infinity),
    sheetCreationDateMaxDay: sheetCards.reduce((max, card) => card.createdDay == null ? max : Math.max(max, card.createdDay), -Infinity),
    sheetUpdateDateMinDay: sheetCards.reduce((min, card) => card.updatedDay == null ? min : Math.min(min, card.updatedDay), Infinity),
    sheetUpdateDateMaxDay: sheetCards.reduce((max, card) => card.updatedDay == null ? max : Math.max(max, card.updatedDay), -Infinity),
    createdAtFrom: cutoff.toISOString(),
    auditedAt: now.toISOString(),
    appliedFilters: filters,
    workspaceId: process.env.HABLLA_WORKSPACE_ID,
    boardId: process.env.HABLLA_BOARD_ID,
    totalCardsCreatedSinceStart: cards.length,
    apiSheetComparison: {
      sheetCardRowsWithId: sheetCards.length,
      sheetCardsCreatedSinceStart: sheetCardsInWindowById.size,
      apiCardsMissingFromSheetSinceStart: Math.max(0, cards.length - matchedIds.length),
      sheetCardsNotReturnedByApiSinceStart: sheetOnlyIds.length,
      idsMatchedBetweenApiAndSheet: matchedIds.length,
      duplicatedSheetRowsForSameCardId: duplicatedSheetRows,
      sheetCardsWithFinishedAtSinceStart: sheetFinishedInWindow,
      sheetCardsInCampaignListSinceStart: sheetCampaignList,
      sheetCardsInSapoDisparoListSinceStart: sheetSapoList,
      sheetSapoDisparoNamedAtivoDescontoSinceStart: sheetSapoCampaign.length,
      sheetSapoDisparoNamedAtivoDescontoWithPhone: sheetSapoCampaignPhone,
      sheetSapoDisparoNamedAtivoDescontoFinished: sheetSapoCampaign.filter((card) => card.finishedAt !== "").length,
      sheetSapoListWindowFinishedAtRows: sheetCardsInWindow.filter((card) => card.list === SAPO_DISPARO_LIST && card.finishedAt !== "").length,
      sheetOnlyCardCreatedDayMin: sheetOnlyIds.length ? Math.min(...sheetOnlyIds.map((card) => card.createdDay)) : null,
      sheetOnlyCardCreatedDayMax: sheetOnlyIds.length ? Math.max(...sheetOnlyIds.map((card) => card.createdDay)) : null,
      apiCardsCreatedSinceStartAlsoFoundAnywhereInSheet: apiIdsInSheetWhole,
      nexusInputRowsInDateWindow: nexusRowsFromSheet.length,
      exactNexusFilterFunnel: sheetFunnel.summary,
      exactNexusUniquePhones: sheetFunnel.rows.length,
      apiEquivalentNexusFilterFunnel: apiFunnel.summary,
      apiEquivalentNexusUniquePhones: apiFunnel.rows.length,
    },
    withPhoneOnCardOrPhoneCustomField: withPhone,
    finishedAtFilled: finished,
    campaignNameMatched: campaignName,
    discountCardNameMatched: discountCardName,
    sapoListNamedAtivoDesconto: {
      apiCount: sapoCampaignName,
      apiFinishedAtFilled: sapoCampaignFinished,
      apiCreatedSinceCutoff: sapoCampaignWindow,
      apiWithPhone: sapoCampaignWithPhone,
    },
    sapoNexusFilterPipeline: {
      cardsCreatedSinceCutoffInTargetList: apiSapoListWindow.length,
      thoseWithFinishedAt: apiSapoListFinishedWindow.length,
      finishedAndNamedAtivoDesconto: apiSapoListFinishedNameWindow.length,
      finishedAndNamedAtivoDescontoWithSheetPhone: apiSapoListFinishedNameWindowWithSheetPhone,
    },
    previousProductionRun: historicLog.summary || null,
    note: "API window uses the same bounded updated_at pagination as Sheets sync; counts deduplicated by card id.",
    campaignListId: CAMPAIGN_LIST,
    cardsInCampaignList: campaignList,
    sapoDisparoListId: SAPO_DISPARO_LIST,
    cardsInSapoDisparoList: sapoDisparoList,
    campaignTagIds: [...CAMPAIGN_TAGS],
    cardsWithCampaignTag: campaignTag,
    cardsWithFirstCampaignTag: campaignTagFirst,
    cardsWithSecondCampaignTag: campaignTagSecond,
    topLists: largestLists,
  }, null, 2));
}

main().catch((error) => {
  console.error(`Hablla audit failed: ${error.message}`);
  process.exitCode = 1;
});




