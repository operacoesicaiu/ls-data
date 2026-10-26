const getHabllaClient = require("../src/hablla/api");
const collectHabllaCards = require("../src/hablla/card-collector");

const CAMPAIGN_LIST = "6a873ec8a02f500d3ab0f07f";
const SAPO_DISPARO_LIST = "684b0513919fd2dca2e5f343";
const CAMPAIGN_TAG = "683736f993808f81627b3f01";

function listId(value) {
  if (typeof value === "string" || typeof value === "number") return String(value);
  return String(value?.id || value?._id || "");
}

function tagIds(card) {
  return (Array.isArray(card.tags) ? card.tags : []).map((tag) =>
    typeof tag === "string" ? tag : String(tag?.id || tag?._id || ""),
  );
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

  const byList = new Map();
  let campaignName = 0;
  let discountCardName = 0;
  let campaignList = 0;
  let sapoDisparoList = 0;
  let campaignTag = 0;
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
    if (tagIds(card).includes(CAMPAIGN_TAG)) campaignTag += 1;
    if (card.finished_at) finished += 1;
    const customPhone = (card.custom_fields || []).some((field) =>
      String(field?.custom_field?.id || field?.custom_field || "") === phoneFieldId
      && /\d{10,}/.test(String(field.value || "")),
    );
    const cardPhone = /\d{10,}/.test(String(card.phone || ""));
    if (customPhone || cardPhone) withPhone += 1;
  }

  const largestLists = [...byList.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 12)
    .map(([id, count]) => ({ id, count }));

  console.log(JSON.stringify({
    audit: "read-only Hablla card count; no sheet writes",
    createdAtFrom: cutoff.toISOString(),
    auditedAt: now.toISOString(),
    workspaceId: process.env.HABLLA_WORKSPACE_ID,
    boardId: process.env.HABLLA_BOARD_ID,
    totalCardsCreatedSinceStart: cards.length,
    withPhoneOnCardOrPhoneCustomField: withPhone,
    finishedAtFilled: finished,
    campaignNameMatched: campaignName,
    discountCardNameMatched: discountCardName,
    campaignListId: CAMPAIGN_LIST,
    cardsInCampaignList: campaignList,
    sapoDisparoListId: SAPO_DISPARO_LIST,
    cardsInSapoDisparoList: sapoDisparoList,
    campaignTagId: CAMPAIGN_TAG,
    cardsWithCampaignTag: campaignTag,
    topLists: largestLists,
  }, null, 2));
}

main().catch((error) => {
  console.error(`Hablla audit failed: ${error.message}`);
  process.exitCode = 1;
});
