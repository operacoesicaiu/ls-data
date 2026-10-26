const getHabllaClient = require("../src/hablla/api");
const collectHabllaCards = require("../src/hablla/card-collector");
const axios = require("axios");
const { getGoogleAccessToken } = require("../src/google/auth");

const CAMPAIGN_LIST = "6a873ec8a02f500d3ab0f07f";
const SAPO_DISPARO_LIST = "684b0513919fd2dca2e5f343";
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
    : iso ? [Number(iso[1]), Number(iso[2]), Number(iso[3])] : null;
  if (!parts) return null;
  const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  if (date.getUTCFullYear() !== parts[0] || date.getUTCMonth() !== parts[1] - 1 || date.getUTCDate() !== parts[2]) return null;
  return Math.floor(date.getTime() / 86_400_000) + 25569;
}

async function main() {
  const fromDate = process.env.AUDIT_FROM_DATE || "2026-09-28";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate)) throw new Error("AUDIT_FROM_DATE invalida");
  const cutoff = new Date(`${fromDate}T03:00:00.000Z`);
  const now = new Date();
  if (!Number.isFinite(cutoff.getTime()) || cutoff > now) throw new Error("Janela da auditoria invalida");

  const hablla = await getHabllaClient();
  const cards = await collectHabllaCards({
    hablla,
    workspaceId: process.env.HABLLA_WORKSPACE_ID,
    boardId: process.env.HABLLA_BOARD_ID,
    cutoff: cutoff.toISOString(),
    exhaustive: true,
  });

  const sheetId = process.env.HABLLA_SPREADSHEET_ID;
  if (!sheetId) throw new Error("HABLLA_SPREADSHEET_ID ausente");
  const googleToken = await getGoogleAccessToken();
  const ranges = ["'Base Hablla Card'!B2:B", "'Base Hablla Card'!E2:E", "'Base Hablla Card'!H2:H", "'Base Hablla Card'!I2:I", "'Base Hablla Card'!N2:N", "'Base Hablla Card'!O2:O", "'Base Hablla Card'!S2:S", "'Base Hablla Card'!T2:T"];
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
  for (let index = 0; index < sheetRowCount; index += 1) {
    const cardId = String(sheetColumns[3][index] || "").trim();
    if (!cardId) continue;
    sheetIdCounts.set(cardId, (sheetIdCounts.get(cardId) || 0) + 1);
    sheetCards.push({
      id: cardId,
      createdDay: sheetSerialDay(sheetColumns[0][index]),
      list: String(sheetColumns[1][index] || "").trim(),
      customPhone: String(sheetColumns[2][index] || ""),
      name: String(sheetColumns[3][index] || ""),
      finishedAt: sheetColumns[4][index],
      phone: String(sheetColumns[6][index] || sheetColumns[7][index] || ""),
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
  const matchedIds = [...apiCardsById.keys()].filter((id) => sheetCardsInWindowById.has(id));
  const duplicatedSheetRows = [...sheetIdCounts.values()].reduce((total, count) => total + Math.max(0, count - 1), 0);
  const sheetCampaignList = sheetCardsInWindow.filter((card) => card.list === CAMPAIGN_LIST).length;
  const sheetSapoList = sheetCardsInWindow.filter((card) => card.list === SAPO_DISPARO_LIST).length;
  const sheetFinishedInWindow = sheetCardsInWindow.filter((card) => card.finishedAt !== "").length;
  const sheetSapoCampaign = sheetCardsInWindow.filter((card) => card.list === SAPO_DISPARO_LIST && /ativo de desconto/i.test(card.name));
  const sheetSapoCampaignPhone = sheetSapoCampaign.filter((card) => /\d{10,}/.test(`${card.phone} ${card.customPhone}`)).length;
  const sheetOnlyIds = sheetCardsInWindow.filter((card) => !apiCardsById.has(card.id));

  console.log(JSON.stringify({
    audit: "read-only Hablla card count; no sheet writes",
    createdAtFrom: cutoff.toISOString(),
    auditedAt: now.toISOString(),
    workspaceId: process.env.HABLLA_WORKSPACE_ID,
    boardId: process.env.HABLLA_BOARD_ID,
    totalCardsCreatedSinceStart: cards.length,
    apiSheetComparison: {
      sheetCardRowsWithId: sheetCards.length,
      sheetCardsCreatedSinceStart: sheetCardsInWindow.length,
      apiCardsMissingFromSheetSinceStart: Math.max(0, cards.length - matchedIds.length),
      sheetCardsNotReturnedByApiSinceStart: Math.max(0, sheetCardsInWindow.length - matchedIds.length),
      idsMatchedBetweenApiAndSheet: matchedIds.length,
      duplicatedSheetRowsForSameCardId: duplicatedSheetRows,
      sheetCardsWithFinishedAtSinceStart: sheetFinishedInWindow,
      sheetCardsInCampaignListSinceStart: sheetCampaignList,
      sheetCardsInSapoDisparoListSinceStart: sheetSapoList,
      sheetSapoDisparoNamedAtivoDescontoSinceStart: sheetSapoCampaign.length,
      sheetSapoDisparoNamedAtivoDescontoWithPhone: sheetSapoCampaignPhone,
      sheetSapoDisparoNamedAtivoDescontoFinished: sheetSapoCampaign.filter((card) => card.finishedAt !== "").length,
      sheetOnlyCardCreatedDayMin: sheetOnlyIds.length ? Math.min(...sheetOnlyIds.map((card) => card.createdDay)) : null,
      sheetOnlyCardCreatedDayMax: sheetOnlyIds.length ? Math.max(...sheetOnlyIds.map((card) => card.createdDay)) : null,
      sheetOnlyCardsCountedForDirectGet: sheetOnlyIds.length,
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
