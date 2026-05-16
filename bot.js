"use strict";

const fs = require("fs");
const path = require("path");
const {
  Client,
  Collection,
  Events,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
  SlashCommandBuilder,
  MessageFlags,
  PermissionFlagsBits,
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");

// ============================================================
// CONSTANTS
// ============================================================
const BOT_START_TIME = Date.now();
const DELETE_DELAY    = 5 * 60 * 1000; // 5 minutes

// ============================================================
// CONFIG
// ============================================================
let fileConfig = {};
const configPath = path.join(__dirname, "config.json");
try {
  if (fs.existsSync(configPath)) {
    fileConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));
    console.log("✅ config.json loaded");
  } else {
    console.log("⚠️  config.json not found — using env vars only");
  }
} catch (err) {
  console.error("❌ Failed to read config.json:", err.message);
}

const TOKEN                  = (process.env.TOKEN                  || fileConfig.token                  || "").trim();
const CLIENT_ID              = (process.env.CLIENT_ID              || fileConfig.clientId               || "").trim();
const GUILD_ID               = (process.env.GUILD_ID               || fileConfig.guildId               || "").trim();
const WEBHOOK_CHANNEL_ID     = (process.env.WEBHOOK_CHANNEL_ID     || fileConfig.webhookChannelId       || "1495182417802297556").trim();
const CUSTOMER_ROLE_ID       = (process.env.CUSTOMER_ROLE_ID       || fileConfig.customerRoleId         || "1495237655615635626").trim();
const SUGGESTION_CHANNEL_ID  = (process.env.SUGGESTION_CHANNEL_ID  || fileConfig.suggestionChannelId    || "1497697848953798818").trim();
const FEEDBACK_CHANNEL_ID    = (process.env.FEEDBACK_CHANNEL_ID    || fileConfig.feedbackChannelId      || "1495237592642355251").trim();
const FEEDBACK_ROLE_ID       = (process.env.FEEDBACK_ALLOWED_ROLE_ID || fileConfig.feedbackAllowedRoleId || "1495237655615635626").trim();
const MOD_LOG_CHANNEL_ID     = (process.env.MOD_LOG_CHANNEL_ID     || fileConfig.modLogChannelId        || "").trim();
const BOT_COMMANDS_CHANNEL_ID = (process.env.BOT_COMMANDS_CHANNEL_ID || fileConfig.botCommandsChannelId || "1503104899758555329").trim();

// Public-output commands that any member can run.
// These are restricted to BOT_COMMANDS_CHANNEL_ID to keep other channels clean.
// Mod/admin commands are NOT restricted — staff can use them anywhere.
const CHANNEL_RESTRICTED_COMMANDS = new Set([
  "ping",
  "uptime",
  "avatar",
  "userinfo",
  "serverinfo",
  "roleinfo",
  "whois",
  "timeline",
  "quote",
  "help",
]);

// ── External API keys (optional; commands disable themselves if missing) ──
const FINNHUB_API_KEY = (process.env.FINNHUB_API_KEY || fileConfig.finnhubApiKey || "").trim();

// ── SellAuth sales notifications (optional) ──
const SELLAUTH_API_KEY          = (process.env.SELLAUTH_API_KEY          || fileConfig.sellauthApiKey          || "").trim();
const SELLAUTH_SHOP_ID          = (process.env.SELLAUTH_SHOP_ID          || fileConfig.sellauthShopId          || "231922").trim();
const SELLAUTH_SALES_CHANNEL_ID = (process.env.SELLAUTH_SALES_CHANNEL_ID || fileConfig.sellauthSalesChannelId || "1503108866517242090").trim();
const STOREFRONT_REFRESH_SECONDS = Math.max(30, parseInt(process.env.STOREFRONT_REFRESH_SECONDS || fileConfig.storefrontRefreshSeconds || "120", 10) || 120);

// ============================================================
// REACTION ROLES CONFIG
// Add new entries here to expose more self-assignable roles.
// ============================================================
const REACTION_ROLES_CHANNEL_ID = "1501592394003386570";
const REACTION_ROLES = [
  {
    roleId: "1502516354371162255",
    label: "Stock Pings",
    emoji: "📈",
    description: "Get pinged when new stock alerts drop",
    style: ButtonStyle.Primary,
  },
  {
    roleId: "1503137684204556290",
    label: "Cheeze Update Pings",
    emoji: "🧀",
    description: "Get pinged for Cheeze updates",
    style: ButtonStyle.Secondary,
  },
  // To add more buttons, just append:
  // { roleId: "ROLE_ID", label: "Button Label", emoji: "🔥", description: "...", style: ButtonStyle.Secondary },
];

if (!TOKEN) {
  console.error("❌ TOKEN is missing. Set it in config.json or as an env var.");
  process.exit(1);
}

// ============================================================
// PERSISTENCE HELPERS
// ============================================================
function readJSON(filePath, defaultValue) {
  try {
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, JSON.stringify(defaultValue, null, 2));
      return defaultValue;
    }
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (err) {
    console.error(`❌ Failed to read ${filePath}:`, err.message);
    return defaultValue;
  }
}

function writeJSON(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error(`❌ Failed to write ${filePath}:`, err.message);
  }
}

// ============================================================
// WARNINGS
// ============================================================
const WARNINGS_FILE = path.join(__dirname, "warnings.json");
let warningsData    = {};

function loadWarnings()                   { warningsData = readJSON(WARNINGS_FILE, {}); console.log("✅ warnings.json loaded"); }
function saveWarnings()                   { writeJSON(WARNINGS_FILE, warningsData); }
function getUserWarnings(userId)          { return warningsData[userId] || []; }
function addWarning(userId, reason, staffId) {
  if (!warningsData[userId]) warningsData[userId] = [];
  warningsData[userId].push({ reason, staffId, timestamp: new Date().toISOString() });
  saveWarnings();
}
function clearWarnings(userId)            { delete warningsData[userId]; saveWarnings(); }

// ============================================================
// VERIFIED ORDERS
// ============================================================
const VERIFIED_FILE = path.join(__dirname, "verified-orders.json");
let verifiedOrders  = new Set();

function normalizeOrderId(value) { return String(value || "").trim().toUpperCase(); }

function loadVerifiedOrders() {
  const data = readJSON(VERIFIED_FILE, { orders: [] });
  verifiedOrders = new Set((data.orders || []).map(normalizeOrderId));
  console.log(`✅ Loaded ${verifiedOrders.size} verified order(s)`);
}

function saveVerifiedOrders() {
  writeJSON(VERIFIED_FILE, { orders: Array.from(verifiedOrders) });
}

function extractOrderIdFromMessage(message) {
  const sources = [message.content || ""];
  for (const emb of message.embeds || []) {
    sources.push(emb.title || "", emb.description || "");
    for (const f of emb.fields || []) sources.push(f.name || "", f.value || "");
  }
  const pattern = /(?:invoice|order)(?:\s*id)?\s*[:#\-]?\s*([A-Za-z0-9\-]+)/i;
  for (const s of sources) {
    const m = s.match(pattern);
    if (m?.[1]) return m[1];
  }
  return null;
}

// ============================================================
// SELLAUTH STOREFRONT EMBED (manual /stock command)
// State file remembers the storefront post so we can edit/delete it.
// ============================================================
const SELLAUTH_STATE_FILE = path.join(__dirname, "sellauth-state.json");
let storefrontPost = null; // { channelId, messageId }

/** Throttle noisy Pebble/console logs during long SellAuth outages (same root cause ~10 minutes). */
const STOREFRONT_FAIL_LOG_INTERVAL_MS = 10 * 60 * 1000;
let storefrontFailLog = { t: 0, key: "", quiet: 0 };
let sellAuthAutoRefreshPreviouslyFailed = false;
/** Cleared interval when SellAuth returns 401/403 so we stop hammering the API every refresh tick. */
let storefrontAutoRefreshIntervalId = null;
let storefrontAutoRefreshSuspendedBadAuth = false;

function sellAuthUnauthorizedMessage(text) {
  return /\bSellAuth API (401|403)\b/.test(String(text ?? ""));
}

function suspendStorefrontAutoRefreshForBadSellAuth(reason) {
  storefrontAutoRefreshSuspendedBadAuth = true;
  if (storefrontAutoRefreshIntervalId !== null) {
    clearInterval(storefrontAutoRefreshIntervalId);
    storefrontAutoRefreshIntervalId = null;
  }
  console.warn(
    `⚠️  Storefront auto-refresh stopped — SellAuth API key rejected (${squashOneLine(String(reason), 220)}). ` +
      "Create or rotate your key under Dashboard → Account → API Access (Bearer token). " +
      "Set `SELLAUTH_API_KEY` or `sellauthApiKey`, confirm `SELLAUTH_SHOP_ID` / `sellauthShopId` matches your shop, restart the bot, then `/stock refresh`."
  );
}

function resumeStorefrontAutoRefreshTimer(client) {
  if (!storefrontAutoRefreshSuspendedBadAuth) return;
  if (!SELLAUTH_API_KEY) return;
  storefrontAutoRefreshSuspendedBadAuth = false;
  if (storefrontAutoRefreshIntervalId !== null) clearInterval(storefrontAutoRefreshIntervalId);
  storefrontAutoRefreshIntervalId = setInterval(() => autoRefreshStorefront(client), STOREFRONT_REFRESH_SECONDS * 1000);
  console.log(`✅ Storefront auto-refresh restarted (SellAuth accepts the key; every ${STOREFRONT_REFRESH_SECONDS}s)`);
}

function loadSellAuthState() {
  const data = readJSON(SELLAUTH_STATE_FILE, { storefront: null });
  storefrontPost = data.storefront || null;
}
function saveSellAuthState() {
  writeJSON(SELLAUTH_STATE_FILE, { storefront: storefrontPost });
}

function squashOneLine(s, max = 160) {
  return String(s).replace(/\s+/g, " ").trim().slice(0, max);
}

function logStorefrontRefreshFailure(detail) {
  const key = squashOneLine(String(detail), 320);
  const now = Date.now();
  if (key === storefrontFailLog.key && now - storefrontFailLog.t < STOREFRONT_FAIL_LOG_INTERVAL_MS) {
    storefrontFailLog.quiet++;
    return;
  }
  const extra = storefrontFailLog.quiet ? ` (${storefrontFailLog.quiet} similar — not spamming logs)` : "";
  storefrontFailLog = { t: now, key, quiet: 0 };
  console.warn(`⚠️  Storefront auto-refresh failed: ${key}${extra}`);
}

async function fetchSellAuthProductsJsonPage(page) {
  const url = new URL(`https://api.sellauth.com/v1/shops/${SELLAUTH_SHOP_ID}/products`);
  url.searchParams.set("page", String(page));
  url.searchParams.set("perPage", "100");
  url.searchParams.set("orderColumn", "name");
  url.searchParams.set("orderDirection", "asc");

  const headers = { Authorization: `Bearer ${SELLAUTH_API_KEY}`, Accept: "application/json" };
  let lastErr;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { headers });
      const text = await res.text().catch(() => "");
      if (!res.ok) {
        const brief = squashOneLine(text, 180);
        const detail = `${res.status}${brief ? ` — ${brief}` : ""}`;
        if (attempt < 3 && (res.status >= 500 || res.status === 429)) {
          await new Promise((r) => setTimeout(r, 850 * attempt));
          continue;
        }
        throw new Error(`SellAuth API ${detail}`);
      }
      return JSON.parse(text);
    } catch (e) {
      lastErr = e;
      const msg = String(e?.message ?? e);
      const fatalClient = /\bSellAuth API (401|403|404|422)\b/.test(msg);
      const transient =
        /\b(fetch failed|NetworkError|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket|timed out)\b/i.test(msg) ||
        (/\bSellAuth API\b/.test(msg) && /\b(429|5\d\d|522|523|524)\b/.test(msg));
      if (attempt >= 3 || fatalClient || !transient) throw e;
      await new Promise((r) => setTimeout(r, 850 * attempt));
    }
  }
  throw lastErr;
}

async function fetchAllSellAuthProducts() {
  const all = [];
  let page = 1;
  while (true) {
    const json = await fetchSellAuthProductsJsonPage(page);
    const data = json.data || [];
    all.push(...data);
    if (!json.next_page_url || data.length === 0) break;
    page += 1;
    if (page > 50) break; // hard safety stop
  }
  return all;
}

function formatPrice(value, currency = "USD") {
  if (value == null || value === "") return "—";
  const n = Number(value);
  if (isNaN(n)) return String(value);
  return `$${n.toFixed(2)} ${currency}`;
}

function pickProductPrice(product) {
  // Prefer the cheapest variant; fall back to product.price.
  const prices = (product.variants || [])
    .map(v => Number(v.price))
    .filter(n => !isNaN(n) && n > 0);
  if (prices.length) return Math.min(...prices);
  if (product.price != null) {
    const n = Number(product.price);
    if (!isNaN(n)) return n;
  }
  return null;
}

function buildStorefrontEmbed(products) {
  // Filter out hidden products and addons; sort by name
  const visible = products
    .filter(p => p.visibility === "public")
    .filter(p => p.type !== "addon")
    .sort((a, b) => (a.name || "").localeCompare(b.name || ""));

  // Group by category for readability
  const groups = new Map();
  for (const p of visible) {
    const cat = p.category?.name || p.group?.name || "Other";
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat).push(p);
  }

  const nowSeconds = Math.floor(Date.now() / 1000);

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("🛍️ Galaxy Products — Live Stock")
    .setURL("https://galaxyproducts.sellauth.com")
    .setDescription(`🕒 Last updated <t:${nowSeconds}:R> (<t:${nowSeconds}:t>)`);

  if (!visible.length) {
    embed.setDescription(`🕒 Last updated <t:${nowSeconds}:R>\n\n_No public products found._`);
    return embed;
  }

  let totalInStock = 0;
  let totalOutOfStock = 0;

  // Build the visible block(s) for a single product. Returns an array of
  // strings — multiple lines if the product has variants, one line otherwise.
  const renderProduct = (p) => {
    const productStock = Number(p.stock_count) || 0;
    if (productStock > 0) totalInStock += 1; else totalOutOfStock += 1;
    const headIndicator = productStock > 0 ? "🟢" : "🔴";

    const variants = Array.isArray(p.variants) ? p.variants : [];
    const realVariants = variants.filter(v => v && v.name);

    // Single-variant or no-variant: render compact single line
    if (realVariants.length <= 1) {
      const v = realVariants[0];
      const price = v?.price != null ? Number(v.price) : pickProductPrice(p);
      const priceStr = price != null ? formatPrice(price, p.currency) : "—";
      const stockStr = productStock > 0 ? `**${productStock}** in stock` : "*out of stock*";
      return [`${headIndicator} **${p.name}** — \`${priceStr}\` • ${stockStr}`];
    }

    // Multi-variant: header line + indented variant lines
    const out = [`${headIndicator} **${p.name}** ⌄`];
    for (const v of realVariants) {
      const vStock = Number(v.stock) || 0;
      const vPrice = v.price != null ? Number(v.price) : null;
      const vPriceStr = vPrice != null ? formatPrice(vPrice, p.currency) : "—";
      const vIndicator = vStock > 0 ? "🟢" : "🔴";
      const vStockStr  = vStock > 0 ? `**${vStock}** in stock` : "*out of stock*";
      out.push(`\u2003╰ ${vIndicator} ${v.name} — \`${vPriceStr}\` • ${vStockStr}`);
    }
    return out;
  };

  for (const [category, items] of groups) {
    // Each "block" is the array of lines for one product. We never split
    // a product's lines across two fields.
    const blocks = items.map(renderProduct);

    let buf = "";
    let part = 1;
    const flush = () => {
      embed.addFields({
        name: part === 1 ? `📦 ${category}` : `📦 ${category} (cont.)`,
        value: buf || "—",
        inline: false,
      });
      buf = "";
      part += 1;
    };

    for (const block of blocks) {
      const blockText = block.join("\n");
      // If adding this product would overflow the 1024 char field limit, flush.
      if (buf && (buf.length + 1 + blockText.length) > 1000) flush();
      buf += (buf ? "\n" : "") + blockText;
    }
    if (buf) flush();
  }

  embed.setFooter({
    text: `${totalInStock} in stock • ${totalOutOfStock} out of stock`,
  });
  embed.setTimestamp(new Date(nowSeconds * 1000));

  return embed;
}

// Auto-refresh the storefront embed in place. Skips silently when nothing is
// posted, when SellAuth isn't configured, or on transient API errors.
async function autoRefreshStorefront(client) {
  if (!SELLAUTH_API_KEY || !storefrontPost) return;
  try {
    const ch  = await client.channels.fetch(storefrontPost.channelId).catch(() => null);
    const msg = await ch?.messages.fetch(storefrontPost.messageId).catch(() => null);
    if (!msg) {
      console.warn("⚠️  Storefront message missing — clearing tracking.");
      storefrontPost = null;
      saveSellAuthState();
      return;
    }
    const products = await fetchAllSellAuthProducts();
    await msg.edit({ embeds: [buildStorefrontEmbed(products)] });
    if (sellAuthAutoRefreshPreviouslyFailed) {
      console.log("✅ Storefront auto-refresh recovered (SellAuth responded).");
      sellAuthAutoRefreshPreviouslyFailed = false;
    }
    storefrontFailLog = { t: 0, key: "", quiet: 0 };
  } catch (err) {
    sellAuthAutoRefreshPreviouslyFailed = true;
    const reason = err?.message ?? String(err);
    if (sellAuthUnauthorizedMessage(reason)) {
      suspendStorefrontAutoRefreshForBadSellAuth(reason);
      return;
    }
    logStorefrontRefreshFailure(reason);
  }
}

function startStorefrontAutoRefresh(client) {
  if (!SELLAUTH_API_KEY) return;
  storefrontAutoRefreshSuspendedBadAuth = false;
  if (storefrontAutoRefreshIntervalId !== null) clearInterval(storefrontAutoRefreshIntervalId);
  storefrontAutoRefreshIntervalId = setInterval(() => autoRefreshStorefront(client), STOREFRONT_REFRESH_SECONDS * 1000);
  console.log(`✅ Storefront auto-refresh every ${STOREFRONT_REFRESH_SECONDS}s`);
}

// ============================================================
// GIVEAWAYS
// ============================================================
const GIVEAWAY_FILE = path.join(__dirname, "giveaways.json");
let giveaways       = {};

function loadGiveaways() {
  giveaways = readJSON(GIVEAWAY_FILE, {});
  console.log(`✅ Loaded ${Object.keys(giveaways).length} giveaway(s)`);
}
function saveGiveaways() { writeJSON(GIVEAWAY_FILE, giveaways); }

function parseDuration(str) {
  const m = String(str).match(/^(\d+)(s|m|h|d)$/i);
  if (!m) return null;
  const multipliers = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return parseInt(m[1]) * multipliers[m[2].toLowerCase()];
}

function pickWinners(entries, count) {
  return [...entries].sort(() => Math.random() - 0.5).slice(0, Math.min(count, entries.length));
}

async function endGiveaway(client, messageId, reroll = false) {
  const gw = giveaways[messageId];
  if (!gw) return null;
  gw.ended = true;
  saveGiveaways();

  const channel = await client.channels.fetch(gw.channelId).catch(() => null);
  if (!channel) return null;

  const gwMessage = await channel.messages.fetch(messageId).catch(() => null);
  const winners   = pickWinners(gw.entries, gw.winnersCount);
  const mentions  = winners.length ? winners.map(id => `<@${id}>`).join(", ") : "No valid entries";

  const embed = new EmbedBuilder()
    .setColor(winners.length ? 0xf1c40f : 0x95a5a6)
    .setTitle(`🎉 ${reroll ? "Rerolled — " : ""}Giveaway Ended: ${gw.prize}`)
    .setDescription(
      `**Winner(s):** ${mentions}\n**Hosted by:** <@${gw.hostId}>\n**Entries:** ${gw.entries.length}\n**Winners:** ${gw.winnersCount}`
    )
    .setTimestamp();

  if (gwMessage) await gwMessage.edit({ embeds: [embed], components: [] }).catch(() => {});

  if (winners.length) {
    await channel.send({ content: `🎊 Congrats ${mentions}! You won **${gw.prize}**!`, embeds: [embed] }).catch(() => {});
  } else {
    await channel.send({ content: `😔 Giveaway for **${gw.prize}** ended with no entries.` }).catch(() => {});
  }

  return winners;
}

async function scheduleGiveaways(client) {
  const now = Date.now();
  for (const [msgId, gw] of Object.entries(giveaways)) {
    if (gw.ended) continue;
    const remaining = gw.endsAt - now;
    if (remaining <= 0) await endGiveaway(client, msgId);
    else setTimeout(() => endGiveaway(client, msgId), remaining);
  }
}

// ============================================================
// MOD LOG
// ============================================================
async function sendModLog(client, embed) {
  if (!MOD_LOG_CHANNEL_ID) return;
  try {
    const ch = await client.channels.fetch(MOD_LOG_CHANNEL_ID).catch(() => null);
    if (ch?.isTextBased()) await ch.send({ embeds: [embed] });
  } catch (err) {
    console.error("Mod log error:", err);
  }
}

// ============================================================
// AUTO-DELETE / REPLY HELPERS
// ============================================================
function scheduleDelete(msgOrInteraction, ms = DELETE_DELAY) {
  setTimeout(() => {
    if (typeof msgOrInteraction.delete === "function") {
      msgOrInteraction.delete().catch(() => {});
    } else {
      msgOrInteraction.deleteReply().catch(() => {});
    }
  }, ms);
}

// Reply (or edit existing reply) and schedule auto-delete.
// Replaces the deprecated `fetchReply: true` pattern.
async function replyTemp(interaction, payload) {
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply(payload).catch(() => {});
  } else {
    await interaction.reply(payload).catch(() => {});
  }
  scheduleDelete(interaction);
}

// ============================================================
// PENDING MODAL TARGETS
// Used by /announce and /embed so the user no longer has to type
// the channel ID manually inside the modal.
// ============================================================
const pendingTargets = new Map(); // key -> { channelId, expiresAt }
const PENDING_TTL = 5 * 60 * 1000;

function rememberTarget(userId, kind, channelId) {
  pendingTargets.set(`${userId}:${kind}`, { channelId, expiresAt: Date.now() + PENDING_TTL });
}
function consumeTarget(userId, kind) {
  const key = `${userId}:${kind}`;
  const v = pendingTargets.get(key);
  pendingTargets.delete(key);
  if (!v || v.expiresAt < Date.now()) return null;
  return v.channelId;
}
// Sweep stale entries every minute.
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of pendingTargets) if (v.expiresAt < now) pendingTargets.delete(k);
}, 60_000).unref();

// ============================================================
// DISCORD CLIENT
// ============================================================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ],
  partials: [Partials.Channel],
});

// ============================================================
// SLASH COMMANDS DEFINITION
// ============================================================
const commands = [
  // ── General ──────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Check bot latency"),

  new SlashCommandBuilder()
    .setName("uptime")
    .setDescription("Show how long the bot has been running"),

  new SlashCommandBuilder()
    .setName("avatar")
    .setDescription("Show a user's avatar")
    .addUserOption(o => o.setName("user").setDescription("User (defaults to you)").setRequired(false)),

  new SlashCommandBuilder()
    .setName("userinfo")
    .setDescription("View info about a user")
    .addUserOption(o => o.setName("user").setDescription("User (defaults to you)").setRequired(false)),

  new SlashCommandBuilder()
    .setName("serverinfo")
    .setDescription("View info about this server"),

  new SlashCommandBuilder()
    .setName("roleinfo")
    .setDescription("View info about a role")
    .addRoleOption(o => o.setName("role").setDescription("Role to inspect").setRequired(true)),

  new SlashCommandBuilder()
    .setName("whois")
    .setDescription("Look up a user by ID")
    .addStringOption(o => o.setName("userid").setDescription("User ID").setRequired(true)),

  // ── Orders / Feedback ────────────────────────────────────
  new SlashCommandBuilder()
    .setName("verify")
    .setDescription("Verify a completed invoice/order ID")
    .addStringOption(o => o.setName("orderid").setDescription("Invoice or Order ID").setRequired(true)),

  new SlashCommandBuilder()
    .setName("suggestion")
    .setDescription("Submit a suggestion"),

  new SlashCommandBuilder()
    .setName("feedback")
    .setDescription("Submit feedback (restricted role)"),

  // ── Timeline ─────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName("timeline")
    .setDescription("Display a structured timeline")
    .addStringOption(o => o.setName("title").setDescription("Timeline title").setRequired(true))
    .addStringOption(o =>
      o.setName("events")
        .setDescription('Events: "Label|Date|Description" separated by semicolons')
        .setRequired(true)
    )
    .addStringOption(o => o.setName("color").setDescription("Hex color (e.g. FF5733)").setRequired(false)),

  // ── Giveaway ─────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName("giveaway")
    .setDescription("Giveaway management")
    .addSubcommand(sub =>
      sub.setName("start").setDescription("Start a new giveaway")
        .addStringOption(o => o.setName("prize").setDescription("Prize").setRequired(true))
        .addStringOption(o => o.setName("duration").setDescription("Duration e.g. 10m 2h 1d").setRequired(true))
        .addIntegerOption(o => o.setName("winners").setDescription("Number of winners").setRequired(true).setMinValue(1).setMaxValue(20))
        .addChannelOption(o => o.setName("channel").setDescription("Channel (defaults to current)").setRequired(false))
    )
    .addSubcommand(sub =>
      sub.setName("end").setDescription("End a giveaway now")
        .addStringOption(o => o.setName("messageid").setDescription("Giveaway message ID").setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName("reroll").setDescription("Reroll winners for an ended giveaway")
        .addStringOption(o => o.setName("messageid").setDescription("Giveaway message ID").setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName("stop").setDescription("Cancel a giveaway without picking winners")
        .addStringOption(o => o.setName("messageid").setDescription("Giveaway message ID").setRequired(true))
    )
    .addSubcommand(sub => sub.setName("list").setDescription("List active giveaways"))
    .addSubcommand(sub =>
      sub.setName("duration").setDescription("Edit duration of an active giveaway")
        .addStringOption(o => o.setName("messageid").setDescription("Giveaway message ID").setRequired(true))
        .addStringOption(o => o.setName("duration").setDescription("New duration from now e.g. 30m 1h").setRequired(true))
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

  // ── Moderation ───────────────────────────────────────────
  new SlashCommandBuilder()
    .setName("warn").setDescription("Warn a user")
    .addUserOption(o => o.setName("user").setDescription("User to warn").setRequired(true))
    .addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  new SlashCommandBuilder()
    .setName("warnings").setDescription("View a user's warnings")
    .addUserOption(o => o.setName("user").setDescription("User to check").setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  new SlashCommandBuilder()
    .setName("clearwarnings").setDescription("Clear all warnings for a user")
    .addUserOption(o => o.setName("user").setDescription("User to clear").setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  new SlashCommandBuilder()
    .setName("mute").setDescription("Timeout (mute) a user")
    .addUserOption(o => o.setName("user").setDescription("User to mute").setRequired(true))
    .addIntegerOption(o => o.setName("duration").setDescription("Duration in minutes").setRequired(true).setMinValue(1).setMaxValue(40320))
    .addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  new SlashCommandBuilder()
    .setName("unmute").setDescription("Remove timeout from a user")
    .addUserOption(o => o.setName("user").setDescription("User to unmute").setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  new SlashCommandBuilder()
    .setName("kick").setDescription("Kick a user")
    .addUserOption(o => o.setName("user").setDescription("User to kick").setRequired(true))
    .addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers),

  new SlashCommandBuilder()
    .setName("ban").setDescription("Ban a user")
    .addUserOption(o => o.setName("user").setDescription("User to ban").setRequired(true))
    .addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),

  new SlashCommandBuilder()
    .setName("unban").setDescription("Unban a user by ID")
    .addStringOption(o => o.setName("userid").setDescription("User ID to unban").setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),

  new SlashCommandBuilder()
    .setName("purge").setDescription("Delete multiple messages")
    .addIntegerOption(o => o.setName("amount").setDescription("Number 1-100").setRequired(true).setMinValue(1).setMaxValue(100))
    .addUserOption(o => o.setName("user").setDescription("Only delete from this user").setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

  new SlashCommandBuilder()
    .setName("lock").setDescription("Lock a channel")
    .addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

  new SlashCommandBuilder()
    .setName("unlock").setDescription("Unlock a channel")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

  // ── Staff Tools ──────────────────────────────────────────
  new SlashCommandBuilder()
    .setName("announce").setDescription("Send a formatted announcement embed")
    .addChannelOption(o => o.setName("channel").setDescription("Target channel").setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

  new SlashCommandBuilder()
    .setName("dm").setDescription("Send a DM to a user on behalf of staff")
    .addUserOption(o => o.setName("user").setDescription("User to DM").setRequired(true))
    .addStringOption(o => o.setName("message").setDescription("Message to send").setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  new SlashCommandBuilder()
    .setName("poll").setDescription("Create a poll")
    .addStringOption(o => o.setName("question").setDescription("Poll question").setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

  new SlashCommandBuilder()
    .setName("slowmode").setDescription("Set slowmode on a channel")
    .addIntegerOption(o => o.setName("seconds").setDescription("Seconds (0 to disable)").setRequired(true).setMinValue(0).setMaxValue(21600))
    .addChannelOption(o => o.setName("channel").setDescription("Channel (defaults to current)").setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

  new SlashCommandBuilder()
    .setName("setnick").setDescription("Change a member's nickname")
    .addUserOption(o => o.setName("user").setDescription("User to rename").setRequired(true))
    .addStringOption(o => o.setName("nickname").setDescription("New nickname (leave blank to reset)").setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageNicknames),

  new SlashCommandBuilder()
    .setName("embed").setDescription("Build and send a custom embed")
    .addChannelOption(o => o.setName("channel").setDescription("Target channel").setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

  new SlashCommandBuilder()
    .setName("pin").setDescription("Pin a message by ID")
    .addStringOption(o => o.setName("messageid").setDescription("Message ID to pin").setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

  new SlashCommandBuilder()
    .setName("reactionroles")
    .setDescription("Post the self-assignable reaction-roles embed in the configured channel")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  // ── External APIs ────────────────────────────────────────
  new SlashCommandBuilder()
    .setName("quote")
    .setDescription("Look up a stock market quote")
    .addStringOption(o =>
      o.setName("symbol").setDescription("Ticker symbol e.g. TSLA, AAPL, NVDA").setRequired(true).setMaxLength(10)
    ),

  // ── SellAuth Storefront ──────────────────────────────────
  new SlashCommandBuilder()
    .setName("stock")
    .setDescription("Manage the live storefront / stock embed")
    .addSubcommand(sub =>
      sub.setName("post").setDescription("Post the storefront embed (all products + stock)")
        .addChannelOption(o => o.setName("channel").setDescription("Override target channel").setRequired(false))
    )
    .addSubcommand(sub =>
      sub.setName("refresh").setDescription("Refresh the existing storefront embed in place")
    )
    .addSubcommand(sub =>
      sub.setName("remove").setDescription("Delete the storefront embed")
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

  // ── Help ─────────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName("help")
    .setDescription("Show all available commands grouped by category")
    .addStringOption(o =>
      o.setName("category")
        .setDescription("Jump straight to a category")
        .setRequired(false)
        .addChoices(
          { name: "General",     value: "general" },
          { name: "Info",        value: "info" },
          { name: "Moderation",  value: "moderation" },
          { name: "Utility",     value: "utility" },
          { name: "Fun",         value: "fun" },
          { name: "Giveaways",   value: "giveaways" },
        )
    ),

].map(c => c.toJSON());

// ============================================================
// REGISTER COMMANDS
// ============================================================
const rest = new REST({ version: "10" }).setToken(TOKEN);

async function registerCommands() {
  if (!CLIENT_ID || !GUILD_ID) {
    console.log("⚠️  Missing CLIENT_ID or GUILD_ID — skipping command registration");
    return;
  }
  try {
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    console.log("✅ Slash commands registered");
  } catch (err) {
    console.error("❌ Command registration failed:", err);
  }
}

// ============================================================
// EVENT: WEBHOOK MESSAGE (auto-store order IDs)
// ============================================================
client.on(Events.MessageCreate, (message) => {
  if (message.channelId !== WEBHOOK_CHANNEL_ID || !message.webhookId) return;
  const found = extractOrderIdFromMessage(message);
  if (!found) return;
  const id = normalizeOrderId(found);
  if (verifiedOrders.has(id)) return;
  verifiedOrders.add(id);
  saveVerifiedOrders();
  console.log(`✅ Stored webhook order: ${id}`);
});

// ============================================================
// EVENT: REACTION-ROLE BUTTON
// ============================================================
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isButton() || !interaction.customId.startsWith("rr_role:")) return;

  const roleId = interaction.customId.slice("rr_role:".length);
  const member = interaction.member;
  if (!interaction.inGuild() || !member) {
    return interaction.reply({ content: "❌ This must be used in a server.", flags: MessageFlags.Ephemeral });
  }

  const role = interaction.guild.roles.cache.get(roleId)
    || await interaction.guild.roles.fetch(roleId).catch(() => null);
  if (!role) {
    return interaction.reply({ content: "❌ That role no longer exists.", flags: MessageFlags.Ephemeral });
  }

  try {
    if (member.roles.cache.has(roleId)) {
      await member.roles.remove(roleId, "Reaction-role toggle (remove)");
      return interaction.reply({ content: `🗑️ Removed the **${role.name}** role.`, flags: MessageFlags.Ephemeral });
    } else {
      await member.roles.add(roleId, "Reaction-role toggle (add)");
      return interaction.reply({ content: `✅ You now have the **${role.name}** role.`, flags: MessageFlags.Ephemeral });
    }
  } catch (err) {
    console.error("Reaction-role toggle error:", err);
    return interaction.reply({
      content: "❌ Couldn't update your roles. Make sure my role is **above** the role you're trying to get.",
      flags: MessageFlags.Ephemeral,
    });
  }
});

// ============================================================
// EVENT: GIVEAWAY BUTTON
// ============================================================
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isButton() || interaction.customId !== "giveaway_enter") return;

  const messageId = interaction.message.id;
  const gw        = giveaways[messageId];

  if (!gw || gw.ended) {
    return interaction.reply({ content: "❌ This giveaway has ended.", flags: MessageFlags.Ephemeral });
  }

  const alreadyEntered = gw.entries.includes(interaction.user.id);
  if (alreadyEntered) {
    gw.entries = gw.entries.filter(id => id !== interaction.user.id);
  } else {
    gw.entries.push(interaction.user.id);
  }
  saveGiveaways();

  const updatedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
    .setFooter({ text: `🎟️ ${gw.entries.length} entr${gw.entries.length === 1 ? "y" : "ies"} • Ends` });
  await interaction.message.edit({ embeds: [updatedEmbed] }).catch(() => {});

  return interaction.reply({
    content: alreadyEntered ? "✅ You have **left** the giveaway." : "🎉 You have **entered** the giveaway! Good luck!",
    flags: MessageFlags.Ephemeral,
  });
});

// ============================================================
// EVENT: MAIN INTERACTION HANDLER
// ============================================================
client.on(Events.InteractionCreate, async (interaction) => {
  // Buttons handled by the dedicated listener above
  if (interaction.isButton()) return;

  try {
    // ── Modals ─────────────────────────────────────────────
    if (interaction.isModalSubmit()) {
      if (interaction.customId === "suggestion_modal") return handleSuggestionModal(interaction);
      if (interaction.customId === "feedback_modal")   return handleFeedbackModal(interaction);
      if (interaction.customId === "announce_modal")   return handleAnnounceModal(interaction);
      if (interaction.customId === "embed_modal")      return handleEmbedModal(interaction);
      return;
    }

    if (!interaction.isChatInputCommand()) return;

    const { commandName: cmd } = interaction;

    // ── Public-command channel gate ────────────────────────
    // Any member-runnable command that posts visible output is locked to
    // BOT_COMMANDS_CHANNEL_ID so chat channels stay clean. Staff bypass via
    // ManageMessages so they can debug anywhere.
    if (
      BOT_COMMANDS_CHANNEL_ID &&
      CHANNEL_RESTRICTED_COMMANDS.has(cmd) &&
      interaction.channelId !== BOT_COMMANDS_CHANNEL_ID &&
      !interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages)
    ) {
      return interaction.reply({
        content: `❌ This command can only be used in <#${BOT_COMMANDS_CHANNEL_ID}>.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    // ── PING ───────────────────────────────────────────────
    if (cmd === "ping") {
      await interaction.reply({ content: `🏓 Pong! Latency: **${client.ws.ping}ms**` });
      scheduleDelete(interaction);
      return;
    }

    // ── HELP ───────────────────────────────────────────────
    if (cmd === "help") {
      const categories = {
        general: {
          title: "🌐 General",
          color: 0x5865f2,
          commands: [
            ["/help",       "Show this command list"],
            ["/ping",       "Check the bot's latency"],
            ["/uptime",     "How long the bot has been online"],
          ],
        },
        info: {
          title: "🔍 Info",
          color: 0x3498db,
          commands: [
            ["/avatar",     "Show a user's avatar"],
            ["/userinfo",   "Show info about a user"],
            ["/serverinfo", "Show info about this server"],
            ["/roleinfo",   "Show info about a role"],
            ["/whois",      "Look up a user by ID"],
          ],
        },
        moderation: {
          title: "🛡️ Moderation",
          color: 0xe74c3c,
          commands: [
            ["/warn",          "Warn a user"],
            ["/warnings",      "View a user's warnings"],
            ["/clearwarnings", "Clear a user's warnings"],
            ["/mute",          "Timeout a user"],
            ["/unmute",        "Remove a timeout"],
            ["/kick",          "Kick a user"],
            ["/ban",           "Ban a user"],
            ["/unban",         "Unban a user by ID"],
            ["/purge",         "Bulk-delete messages"],
            ["/lock",          "Lock a channel"],
            ["/unlock",        "Unlock a channel"],
            ["/slowmode",      "Set channel slowmode"],
            ["/setnick",       "Change a member's nickname"],
          ],
        },
        utility: {
          title: "🧰 Utility",
          color: 0x2ecc71,
          commands: [
            ["/announce",      "Send a formatted announcement"],
            ["/embed",         "Build a custom embed"],
            ["/dm",            "Send a DM as staff"],
            ["/poll",          "Create a poll"],
            ["/pin",           "Pin a message by ID"],
            ["/timeline",      "Post a timeline embed"],
            ["/verify",        "Verify an order/invoice"],
            ["/suggestion",    "Submit a suggestion"],
            ["/feedback",      "Submit feedback"],
            ["/reactionroles", "Post the self-assign role panel"],
            ["/stock post",    "Post the live storefront embed"],
            ["/stock refresh", "Refresh the storefront with latest stock"],
            ["/stock remove",  "Remove the storefront embed"],
          ],
        },
        fun: {
          title: "🎲 Fun",
          color: 0x9b59b6,
          commands: [
            ["/quote", "Look up a stock market quote"],
          ],
        },
        giveaways: {
          title: "🎉 Giveaways",
          color: 0xf1c40f,
          commands: [
            ["/giveaway start",    "Start a new giveaway"],
            ["/giveaway end",      "End a giveaway now"],
            ["/giveaway reroll",   "Reroll winners"],
            ["/giveaway stop",     "Cancel a giveaway"],
            ["/giveaway list",     "List active giveaways"],
            ["/giveaway duration", "Edit a giveaway's duration"],
          ],
        },
      };

      const pick = interaction.options.getString("category");

      if (pick && categories[pick]) {
        const cat = categories[pick];
        const list = cat.commands.map(([n, d]) => `\`${n.padEnd(22)}\` ${d}`).join("\n");
        await interaction.reply({
          embeds: [new EmbedBuilder()
            .setColor(cat.color)
            .setTitle(cat.title)
            .setDescription(list)
            .setFooter({ text: `${cat.commands.length} commands • Use /help for the full list` })
            .setTimestamp()],
          flags: 64,
        });
        return;
      }

      const total = Object.values(categories).reduce((n, c) => n + c.commands.length, 0);
      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle("📖 Bot Commands")
        .setDescription(`**${total}** commands across **${Object.keys(categories).length}** categories.\nUse \`/help category:<name>\` for details.`)
        .setThumbnail(client.user.displayAvatarURL({ size: 256 }))
        .setTimestamp();

      for (const cat of Object.values(categories)) {
        embed.addFields({
          name: `${cat.title}  •  ${cat.commands.length}`,
          value: cat.commands.map(([n]) => `\`${n}\``).join(" "),
          inline: false,
        });
      }

      await interaction.reply({ embeds: [embed], flags: 64 });
      return;
    }

    // ── UPTIME ─────────────────────────────────────────────
    if (cmd === "uptime") {
      const ms  = Date.now() - BOT_START_TIME;
      const s   = Math.floor(ms / 1_000) % 60;
      const m   = Math.floor(ms / 60_000) % 60;
      const h   = Math.floor(ms / 3_600_000) % 24;
      const d   = Math.floor(ms / 86_400_000);
      await interaction.reply({
        embeds: [new EmbedBuilder().setColor(0x3498db).setTitle("⏱️ Bot Uptime")
          .setDescription(`\`${d}d ${h}h ${m}m ${s}s\``).setTimestamp()],
      });
      scheduleDelete(interaction);
      return;
    }

    // ── AVATAR ─────────────────────────────────────────────
    if (cmd === "avatar") {
      const target = interaction.options.getUser("user") || interaction.user;
      const url    = target.displayAvatarURL({ size: 4096, extension: "png" });
      await interaction.reply({
        embeds: [new EmbedBuilder().setColor(0x9b59b6).setTitle(`🖼️ ${target.username}'s Avatar`)
          .setImage(url).setDescription(`[Open full size](${url})`).setTimestamp()],
      });
      scheduleDelete(interaction);
      return;
    }

    // ── USERINFO ───────────────────────────────────────────
    if (cmd === "userinfo") {
      const target = interaction.options.getUser("user") || interaction.user;
      const member = await interaction.guild.members.fetch(target.id).catch(() => null);
      const roles  = member
        ? member.roles.cache.filter(r => r.id !== interaction.guild.id).map(r => `${r}`).join(", ") || "None"
        : "N/A";
      await interaction.reply({
        embeds: [new EmbedBuilder().setColor(0x1abc9c).setTitle(`👤 User Info — ${target.username}`)
          .setThumbnail(target.displayAvatarURL({ size: 256 }))
          .addFields(
            { name: "User",           value: `${target}`,                                                        inline: true },
            { name: "User ID",        value: target.id,                                                          inline: true },
            { name: "Account Created",value: `<t:${Math.floor(target.createdTimestamp / 1000)}:F>` },
            { name: "Joined Server",  value: member ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:F>` : "Not in server" },
            { name: "Boosting",       value: member?.premiumSince ? "✅ Yes" : "❌ No",                          inline: true },
            { name: "Bot",            value: target.bot          ? "✅ Yes" : "❌ No",                           inline: true },
            { name: "Roles",          value: roles.length > 1024 ? roles.slice(0, 1021) + "..." : roles }
          ).setTimestamp()],
      });
      scheduleDelete(interaction);
      return;
    }

    // ── SERVERINFO ─────────────────────────────────────────
    if (cmd === "serverinfo") {
      const g = interaction.guild;
      await g.fetch();
      await interaction.reply({
        embeds: [new EmbedBuilder().setColor(0xe74c3c).setTitle(`🏠 Server Info — ${g.name}`)
          .setThumbnail(g.iconURL({ size: 256 }))
          .addFields(
            { name: "Server ID",          value: g.id,                                              inline: true },
            { name: "Owner",              value: `<@${g.ownerId}>`,                                 inline: true },
            { name: "Created",            value: `<t:${Math.floor(g.createdTimestamp / 1000)}:F>` },
            { name: "Members",            value: `${g.memberCount}`,                                inline: true },
            { name: "Channels",           value: `${g.channels.cache.size}`,                        inline: true },
            { name: "Roles",              value: `${g.roles.cache.size}`,                           inline: true },
            { name: "Boost Level",        value: `Level ${g.premiumTier}`,                          inline: true },
            { name: "Boosts",             value: `${g.premiumSubscriptionCount || 0}`,              inline: true },
            { name: "Verification Level", value: `${g.verificationLevel}`,                          inline: true }
          ).setTimestamp()],
      });
      scheduleDelete(interaction);
      return;
    }

    // ── ROLEINFO ───────────────────────────────────────────
    if (cmd === "roleinfo") {
      const role        = interaction.options.getRole("role", true);
      const memberCount = interaction.guild.members.cache.filter(m => m.roles.cache.has(role.id)).size;
      const perms       = role.permissions.toArray().join(", ") || "None";
      await interaction.reply({
        embeds: [new EmbedBuilder().setColor(role.color || 0x95a5a6).setTitle(`🎭 Role Info — ${role.name}`)
          .addFields(
            { name: "Role ID",     value: role.id,       inline: true },
            { name: "Color",       value: role.hexColor, inline: true },
            { name: "Position",    value: `${role.position}`, inline: true },
            { name: "Members",     value: `${memberCount}`,   inline: true },
            { name: "Mentionable", value: role.mentionable ? "✅" : "❌", inline: true },
            { name: "Hoisted",     value: role.hoist       ? "✅" : "❌", inline: true },
            { name: "Created",     value: `<t:${Math.floor(role.createdTimestamp / 1000)}:F>` },
            { name: "Permissions", value: perms.length > 1024 ? perms.slice(0, 1021) + "..." : perms }
          ).setTimestamp()],
      });
      scheduleDelete(interaction);
      return;
    }

    // ── WHOIS ──────────────────────────────────────────────
    if (cmd === "whois") {
      const userId = interaction.options.getString("userid", true).trim();
      await interaction.deferReply();
      const user = await client.users.fetch(userId).catch(() => null);
      if (!user) {
        await interaction.editReply("❌ Could not find a user with that ID.");
        scheduleDelete(interaction);
        return;
      }
      await interaction.editReply({
        embeds: [new EmbedBuilder().setColor(0x34495e).setTitle(`🔍 Whois — ${user.username}`)
          .setThumbnail(user.displayAvatarURL({ size: 256 }))
          .addFields(
            { name: "Username",       value: user.tag,  inline: true },
            { name: "User ID",        value: user.id,   inline: true },
            { name: "Bot",            value: user.bot ? "✅ Yes" : "❌ No", inline: true },
            { name: "Account Created",value: `<t:${Math.floor(user.createdTimestamp / 1000)}:F>` }
          ).setTimestamp()],
      });
      scheduleDelete(interaction);
      return;
    }

    // ── VERIFY ─────────────────────────────────────────────
    if (cmd === "verify") {
      const orderId = normalizeOrderId(interaction.options.getString("orderid", true));
      await interaction.deferReply();
      if (!verifiedOrders.has(orderId)) {
        await interaction.editReply(`❌ Order ID \`${orderId}\` was not found in verified orders.`);
        scheduleDelete(interaction);
        return;
      }
      if (interaction.member && CUSTOMER_ROLE_ID) {
        await interaction.member.roles.add(CUSTOMER_ROLE_ID).catch(() => {});
      }
      await interaction.editReply(`✅ Order \`${orderId}\` verified! You've been granted the customer role.`);
      scheduleDelete(interaction);
      return;
    }

    // ── SUGGESTION ─────────────────────────────────────────
    if (cmd === "suggestion") {
      const modal = new ModalBuilder().setCustomId("suggestion_modal").setTitle("Suggestion");
      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId("suggestion_text")
            .setLabel("What is your suggestion?")
            .setStyle(TextInputStyle.Paragraph)
            .setMinLength(5).setMaxLength(1000)
            .setRequired(true)
            .setPlaceholder("Type your suggestion here...")
        )
      );
      return interaction.showModal(modal);
    }

    // ── FEEDBACK ───────────────────────────────────────────
    if (cmd === "feedback") {
      if (!interaction.inGuild()) {
        return interaction.reply({ content: "❌ Must be used inside a server.", flags: MessageFlags.Ephemeral });
      }
      if (FEEDBACK_ROLE_ID && !interaction.member?.roles.cache.has(FEEDBACK_ROLE_ID)) {
        return interaction.reply({ content: "❌ You don't have permission to use /feedback.", flags: MessageFlags.Ephemeral });
      }
      const modal = new ModalBuilder().setCustomId("feedback_modal").setTitle("Submit Feedback");
      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId("feedback_rating").setLabel("Rating (1-10)").setStyle(TextInputStyle.Short).setMinLength(1).setMaxLength(2).setRequired(true).setPlaceholder("9")
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId("feedback_text").setLabel("Your feedback").setStyle(TextInputStyle.Paragraph).setMinLength(5).setMaxLength(1000).setRequired(true).setPlaceholder("Tell us what you think...")
        )
      );
      return interaction.showModal(modal);
    }

    // ── TIMELINE ───────────────────────────────────────────
    if (cmd === "timeline") {
      const title     = interaction.options.getString("title", true);
      const eventsRaw = interaction.options.getString("events", true);
      const colorHex  = interaction.options.getString("color") || "5865F2";
      const color     = parseInt(colorHex.replace("#", ""), 16);

      const events = eventsRaw.split(";").map(e => e.trim()).filter(Boolean).map(e => {
        const [label = "Event", date = "", description = ""] = e.split("|").map(x => x.trim());
        return { label, date, description };
      });

      if (events.length === 0) {
        await interaction.reply({ content: '❌ No events parsed. Format: `Label|Date|Description` separated by `;`' });
        scheduleDelete(interaction);
        return;
      }

      const lines = events.map((ev, i) => {
        const isLast = i === events.length - 1;
        let line = `${isLast ? "└" : "├"}─ **${ev.label}**`;
        if (ev.date)        line += ` — \`${ev.date}\``;
        if (ev.description) line += `\n${isLast ? "　" : "│"}　 *${ev.description}*`;
        return line;
      }).join("\n");

      const embed = new EmbedBuilder()
        .setColor(isNaN(color) ? 0x5865f2 : color)
        .setTitle(`📅 ${title}`)
        .setDescription(lines.length > 4096 ? lines.slice(0, 4093) + "..." : lines)
        .setFooter({ text: `${events.length} event(s) • Timeline by ${interaction.user.tag}` })
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
      scheduleDelete(interaction);
      return;
    }

    // ── GIVEAWAY ───────────────────────────────────────────
    if (cmd === "giveaway") {
      const sub = interaction.options.getSubcommand();

      if (sub === "start") {
        const prize        = interaction.options.getString("prize", true);
        const durationStr  = interaction.options.getString("duration", true);
        const winnersCount = interaction.options.getInteger("winners", true);
        const targetCh     = interaction.options.getChannel("channel") || interaction.channel;
        const durationMs   = parseDuration(durationStr);

        if (!durationMs) {
          await interaction.reply({ content: "❌ Invalid duration. Use: `10m`, `2h`, `1d`, `30s`" });
          scheduleDelete(interaction);
          return;
        }

        await interaction.deferReply();
        const endsAt = Date.now() + durationMs;

        const embed = new EmbedBuilder()
          .setColor(0xf1c40f)
          .setTitle(`🎉 GIVEAWAY — ${prize}`)
          .setDescription(
            `Click below to enter!\n\n**Prize:** ${prize}\n**Winners:** ${winnersCount}\n**Hosted by:** ${interaction.user}\n**Ends:** <t:${Math.floor(endsAt / 1000)}:R> (<t:${Math.floor(endsAt / 1000)}:F>)`
          )
          .setFooter({ text: "🎟️ 0 entries • Ends" })
          .setTimestamp(endsAt);

        const row     = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId("giveaway_enter").setLabel("🎉 Enter Giveaway").setStyle(ButtonStyle.Primary)
        );
        const gwMsg   = await targetCh.send({ embeds: [embed], components: [row] });

        giveaways[gwMsg.id] = { channelId: targetCh.id, guildId: interaction.guild.id, prize, winnersCount, endsAt, hostId: interaction.user.id, ended: false, entries: [] };
        saveGiveaways();
        setTimeout(() => endGiveaway(client, gwMsg.id), durationMs);

        await interaction.editReply(`✅ Giveaway started in ${targetCh}! Message ID: \`${gwMsg.id}\``);
        scheduleDelete(interaction);
        return;
      }

      if (sub === "end") {
        const messageId = interaction.options.getString("messageid", true).trim();
        await interaction.deferReply();
        const gw = giveaways[messageId];
        if (!gw)       { await interaction.editReply("❌ No giveaway found with that ID.");      scheduleDelete(interaction); return; }
        if (gw.ended)  { await interaction.editReply("❌ That giveaway has already ended.");     scheduleDelete(interaction); return; }
        const winners = await endGiveaway(client, messageId);
        await interaction.editReply(`✅ Ended! Winner(s): ${winners?.length ? winners.map(id => `<@${id}>`).join(", ") : "No entries"}`);
        scheduleDelete(interaction);
        return;
      }

      if (sub === "reroll") {
        const messageId = interaction.options.getString("messageid", true).trim();
        await interaction.deferReply();
        const gw = giveaways[messageId];
        if (!gw)           { await interaction.editReply("❌ No giveaway found with that ID.");             scheduleDelete(interaction); return; }
        if (!gw.ended)     { await interaction.editReply("❌ Use `/giveaway end` first.");                  scheduleDelete(interaction); return; }
        if (!gw.entries.length) { await interaction.editReply("❌ No entries to reroll.");                  scheduleDelete(interaction); return; }
        gw.ended = false;
        const winners = await endGiveaway(client, messageId, true);
        await interaction.editReply(`🔄 Rerolled! New winner(s): ${winners?.length ? winners.map(id => `<@${id}>`).join(", ") : "No entries"}`);
        scheduleDelete(interaction);
        return;
      }

      if (sub === "stop") {
        const messageId = interaction.options.getString("messageid", true).trim();
        await interaction.deferReply();
        const gw = giveaways[messageId];
        if (!gw)      { await interaction.editReply("❌ No giveaway found with that ID."); scheduleDelete(interaction); return; }
        if (gw.ended) { await interaction.editReply("❌ That giveaway has already ended."); scheduleDelete(interaction); return; }
        gw.ended = true;
        saveGiveaways();
        const ch = await client.channels.fetch(gw.channelId).catch(() => null);
        if (ch) {
          const m = await ch.messages.fetch(messageId).catch(() => null);
          if (m) await m.edit({
            embeds: [new EmbedBuilder().setColor(0x95a5a6).setTitle(`❌ Giveaway Cancelled: ${gw.prize}`).setDescription(`Cancelled by <@${interaction.user.id}>.`).setTimestamp()],
            components: [],
          }).catch(() => {});
        }
        await interaction.editReply("✅ Giveaway cancelled. No winners drawn.");
        scheduleDelete(interaction);
        return;
      }

      if (sub === "list") {
        await interaction.deferReply();
        const active = Object.entries(giveaways).filter(([, gw]) => !gw.ended && gw.guildId === interaction.guild.id);
        if (!active.length) {
          await interaction.editReply("📭 No active giveaways in this server.");
          scheduleDelete(interaction);
          return;
        }
        const lines = active.map(([msgId, gw]) =>
          `**${gw.prize}** — <#${gw.channelId}>\nEnds: <t:${Math.floor(gw.endsAt / 1000)}:R> | Entries: ${gw.entries.length} | Winners: ${gw.winnersCount}\nID: \`${msgId}\``
        ).join("\n\n");
        await interaction.editReply({
          embeds: [new EmbedBuilder().setColor(0xf1c40f).setTitle(`🎉 Active Giveaways (${active.length})`).setDescription(lines).setTimestamp()],
        });
        scheduleDelete(interaction);
        return;
      }

      if (sub === "duration") {
        const messageId  = interaction.options.getString("messageid", true).trim();
        const durationStr = interaction.options.getString("duration", true);
        await interaction.deferReply();
        const gw         = giveaways[messageId];
        if (!gw)      { await interaction.editReply("❌ No giveaway found with that ID.");    scheduleDelete(interaction); return; }
        if (gw.ended) { await interaction.editReply("❌ That giveaway has already ended.");   scheduleDelete(interaction); return; }
        const durationMs = parseDuration(durationStr);
        if (!durationMs) { await interaction.editReply("❌ Invalid duration format."); scheduleDelete(interaction); return; }
        const newEndsAt = Date.now() + durationMs;
        gw.endsAt = newEndsAt;
        saveGiveaways();
        const ch = await client.channels.fetch(gw.channelId).catch(() => null);
        if (ch) {
          const m = await ch.messages.fetch(messageId).catch(() => null);
          if (m?.embeds.length) {
            await m.edit({
              embeds: [EmbedBuilder.from(m.embeds[0])
                .setDescription(`Click below to enter!\n\n**Prize:** ${gw.prize}\n**Winners:** ${gw.winnersCount}\n**Hosted by:** <@${gw.hostId}>\n**Ends:** <t:${Math.floor(newEndsAt / 1000)}:R> (<t:${Math.floor(newEndsAt / 1000)}:F>)`)
                .setTimestamp(newEndsAt)],
            }).catch(() => {});
          }
        }
        setTimeout(() => endGiveaway(client, messageId), durationMs);
        await interaction.editReply(`✅ Duration updated. New end: <t:${Math.floor(newEndsAt / 1000)}:F>`);
        scheduleDelete(interaction);
        return;
      }
    }

    // ── WARN ───────────────────────────────────────────────
    if (cmd === "warn") {
      const target = interaction.options.getUser("user", true);
      const reason = interaction.options.getString("reason", true);
      addWarning(target.id, reason, interaction.user.id);
      const count    = getUserWarnings(target.id).length;
      const logEmbed = new EmbedBuilder().setColor(0xf39c12).setTitle("⚠️ Member Warned")
        .addFields(
          { name: "User",            value: `${target} (${target.id})`, inline: true },
          { name: "Staff",           value: `${interaction.user}`,       inline: true },
          { name: "Reason",          value: reason },
          { name: "Total Warnings",  value: `${count}`, inline: true }
        ).setTimestamp();
      await sendModLog(client, logEmbed);
      await interaction.reply({ embeds: [logEmbed] });
      scheduleDelete(interaction);
      return;
    }

    // ── WARNINGS ───────────────────────────────────────────
    if (cmd === "warnings") {
      const target = interaction.options.getUser("user", true);
      const warns  = getUserWarnings(target.id);
      if (!warns.length) {
        await interaction.reply({ content: `✅ ${target.username} has no warnings.` });
        scheduleDelete(interaction);
        return;
      }
      const list = warns.map((w, i) =>
        `**${i + 1}.** ${w.reason} — <t:${Math.floor(new Date(w.timestamp).getTime() / 1000)}:R>`
      ).join("\n");
      await interaction.reply({
        embeds: [new EmbedBuilder().setColor(0xe67e22).setTitle(`⚠️ Warnings for ${target.username}`)
          .setDescription(list.length > 4096 ? list.slice(0, 4093) + "..." : list)
          .setFooter({ text: `Total: ${warns.length}` }).setTimestamp()],
      });
      scheduleDelete(interaction);
      return;
    }

    // ── CLEARWARNINGS ──────────────────────────────────────
    if (cmd === "clearwarnings") {
      const target = interaction.options.getUser("user", true);
      clearWarnings(target.id);
      await interaction.reply({ content: `✅ Cleared all warnings for ${target.username}.` });
      scheduleDelete(interaction);
      return;
    }

    // ── MUTE ───────────────────────────────────────────────
    if (cmd === "mute") {
      const target   = interaction.options.getUser("user", true);
      const duration = interaction.options.getInteger("duration", true);
      const reason   = interaction.options.getString("reason") || "No reason provided";
      const member   = await interaction.guild.members.fetch(target.id).catch(() => null);
      if (!member) {
        await interaction.reply({ content: "❌ That user is not in this server." });
        scheduleDelete(interaction);
        return;
      }
      await member.timeout(duration * 60 * 1000, reason);
      const logEmbed = new EmbedBuilder().setColor(0xe74c3c).setTitle("🔇 Member Muted")
        .addFields(
          { name: "User",     value: `${target} (${target.id})`, inline: true },
          { name: "Staff",    value: `${interaction.user}`,        inline: true },
          { name: "Duration", value: `${duration} minute(s)`,      inline: true },
          { name: "Reason",   value: reason }
        ).setTimestamp();
      await sendModLog(client, logEmbed);
      await interaction.reply({ embeds: [logEmbed] });
      scheduleDelete(interaction);
      return;
    }

    // ── UNMUTE ─────────────────────────────────────────────
    if (cmd === "unmute") {
      const target = interaction.options.getUser("user", true);
      const member = await interaction.guild.members.fetch(target.id).catch(() => null);
      if (!member) {
        await interaction.reply({ content: "❌ That user is not in this server." });
        scheduleDelete(interaction);
        return;
      }
      await member.timeout(null);
      const logEmbed = new EmbedBuilder().setColor(0x2ecc71).setTitle("🔊 Member Unmuted")
        .addFields(
          { name: "User",  value: `${target} (${target.id})`, inline: true },
          { name: "Staff", value: `${interaction.user}`,        inline: true }
        ).setTimestamp();
      await sendModLog(client, logEmbed);
      await interaction.reply({ embeds: [logEmbed] });
      scheduleDelete(interaction);
      return;
    }

    // ── KICK ───────────────────────────────────────────────
    if (cmd === "kick") {
      const target = interaction.options.getUser("user", true);
      const reason = interaction.options.getString("reason") || "No reason provided";
      const member = await interaction.guild.members.fetch(target.id).catch(() => null);
      if (!member) {
        await interaction.reply({ content: "❌ That user is not in this server." });
        scheduleDelete(interaction);
        return;
      }
      await member.kick(reason);
      const logEmbed = new EmbedBuilder().setColor(0xe67e22).setTitle("👢 Member Kicked")
        .addFields(
          { name: "User",   value: `${target.tag} (${target.id})`, inline: true },
          { name: "Staff",  value: `${interaction.user}`,            inline: true },
          { name: "Reason", value: reason }
        ).setTimestamp();
      await sendModLog(client, logEmbed);
      await interaction.reply({ embeds: [logEmbed] });
      scheduleDelete(interaction);
      return;
    }

    // ── BAN ────────────────────────────────────────────────
    if (cmd === "ban") {
      const target = interaction.options.getUser("user", true);
      const reason = interaction.options.getString("reason") || "No reason provided";
      await interaction.guild.members.ban(target.id, { reason });
      const logEmbed = new EmbedBuilder().setColor(0xc0392b).setTitle("🔨 Member Banned")
        .addFields(
          { name: "User",   value: `${target.tag} (${target.id})`, inline: true },
          { name: "Staff",  value: `${interaction.user}`,            inline: true },
          { name: "Reason", value: reason }
        ).setTimestamp();
      await sendModLog(client, logEmbed);
      await interaction.reply({ embeds: [logEmbed] });
      scheduleDelete(interaction);
      return;
    }

    // ── UNBAN ──────────────────────────────────────────────
    if (cmd === "unban") {
      const userId = interaction.options.getString("userid", true).trim();
      await interaction.guild.members.unban(userId).catch(err => { throw new Error(`Unban failed: ${err.message}`); });
      const logEmbed = new EmbedBuilder().setColor(0x27ae60).setTitle("✅ Member Unbanned")
        .addFields(
          { name: "User ID", value: userId,              inline: true },
          { name: "Staff",   value: `${interaction.user}`, inline: true }
        ).setTimestamp();
      await sendModLog(client, logEmbed);
      await interaction.reply({ embeds: [logEmbed] });
      scheduleDelete(interaction);
      return;
    }

    // ── PURGE ──────────────────────────────────────────────
    if (cmd === "purge") {
      const amount     = interaction.options.getInteger("amount", true);
      const filterUser = interaction.options.getUser("user");
      await interaction.deferReply();
      let messages = await interaction.channel.messages.fetch({ limit: 100 });
      if (filterUser) messages = messages.filter(m => m.author.id === filterUser.id);
      const deleted = await interaction.channel.bulkDelete(messages.first(amount), true).catch(() => null);
      await interaction.editReply(`✅ Deleted ${deleted ? deleted.size : 0} message(s).`);
      scheduleDelete(interaction);
      return;
    }

    // ── LOCK ───────────────────────────────────────────────
    if (cmd === "lock") {
      const reason = interaction.options.getString("reason") || "No reason provided";
      await interaction.channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { SendMessages: false });
      const logEmbed = new EmbedBuilder().setColor(0xe74c3c).setTitle("🔒 Channel Locked")
        .addFields(
          { name: "Channel", value: `${interaction.channel}`, inline: true },
          { name: "Staff",   value: `${interaction.user}`,    inline: true },
          { name: "Reason",  value: reason }
        ).setTimestamp();
      await sendModLog(client, logEmbed);
      await interaction.reply({ content: `🔒 Channel locked. Reason: ${reason}` });
      scheduleDelete(interaction);
      return;
    }

    // ── UNLOCK ─────────────────────────────────────────────
    if (cmd === "unlock") {
      await interaction.channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { SendMessages: null });
      const logEmbed = new EmbedBuilder().setColor(0x2ecc71).setTitle("🔓 Channel Unlocked")
        .addFields(
          { name: "Channel", value: `${interaction.channel}`, inline: true },
          { name: "Staff",   value: `${interaction.user}`,    inline: true }
        ).setTimestamp();
      await sendModLog(client, logEmbed);
      await interaction.reply({ content: "🔓 Channel unlocked." });
      scheduleDelete(interaction);
      return;
    }

    // ── ANNOUNCE ───────────────────────────────────────────
    if (cmd === "announce") {
      const channel = interaction.options.getChannel("channel", true);
      if (!channel.isTextBased()) {
        return interaction.reply({ content: "❌ That channel is not text-based.", flags: MessageFlags.Ephemeral });
      }
      rememberTarget(interaction.user.id, "announce", channel.id);
      const modal = new ModalBuilder().setCustomId("announce_modal").setTitle("Announcement");
      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId("announce_title").setLabel("Title").setStyle(TextInputStyle.Short).setMaxLength(256).setRequired(true).setPlaceholder("Announcement title")
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId("announce_body").setLabel("Body").setStyle(TextInputStyle.Paragraph).setMaxLength(4000).setRequired(true).setPlaceholder("Announcement body...")
        )
      );
      return interaction.showModal(modal);
    }

    // ── DM ─────────────────────────────────────────────────
    if (cmd === "dm") {
      const target  = interaction.options.getUser("user", true);
      const message = interaction.options.getString("message", true);
      await interaction.deferReply();
      const sent = await target.send(`📨 **Message from ${interaction.guild.name} Staff:**\n${message}`).catch(() => null);
      await interaction.editReply(sent ? `✅ DM sent to ${target.username}.` : "❌ Could not DM that user (DMs may be disabled).");
      scheduleDelete(interaction);
      return;
    }

    // ── POLL ───────────────────────────────────────────────
    if (cmd === "poll") {
      const question  = interaction.options.getString("question", true);
      const pollEmbed = new EmbedBuilder().setColor(0x3498db).setTitle("📊 Poll").setDescription(question)
        .setFooter({ text: `Poll by ${interaction.user.tag}` }).setTimestamp();
      const pollMsg = await interaction.channel.send({ embeds: [pollEmbed] });
      await pollMsg.react("👍").catch(() => {});
      await pollMsg.react("👎").catch(() => {});
      await interaction.reply({ content: "✅ Poll created!" });
      scheduleDelete(interaction);
      return;
    }

    // ── SLOWMODE ───────────────────────────────────────────
    if (cmd === "slowmode") {
      const seconds = interaction.options.getInteger("seconds", true);
      const target  = interaction.options.getChannel("channel") || interaction.channel;
      await target.setRateLimitPerUser(seconds);
      await interaction.reply({
        content: seconds === 0 ? `✅ Slowmode disabled in ${target}.` : `✅ Slowmode set to ${seconds}s in ${target}.`,
      });
      scheduleDelete(interaction);
      return;
    }

    // ── SETNICK ────────────────────────────────────────────
    if (cmd === "setnick") {
      const target   = interaction.options.getUser("user", true);
      const nickname = interaction.options.getString("nickname") || null;
      const member   = await interaction.guild.members.fetch(target.id).catch(() => null);
      if (!member) {
        await interaction.reply({ content: "❌ That user is not in this server." });
        scheduleDelete(interaction);
        return;
      }
      await member.setNickname(nickname);
      await interaction.reply({ content: nickname ? `✅ Nickname set to **${nickname}**.` : "✅ Nickname reset." });
      scheduleDelete(interaction);
      return;
    }

    // ── EMBED ──────────────────────────────────────────────
    if (cmd === "embed") {
      const channel = interaction.options.getChannel("channel", true);
      if (!channel.isTextBased()) {
        return interaction.reply({ content: "❌ That channel is not text-based.", flags: MessageFlags.Ephemeral });
      }
      rememberTarget(interaction.user.id, "embed", channel.id);
      const modal = new ModalBuilder().setCustomId("embed_modal").setTitle("Custom Embed");
      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId("embed_title").setLabel("Title").setStyle(TextInputStyle.Short).setMaxLength(256).setRequired(true).setPlaceholder("Embed title")
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId("embed_description").setLabel("Description").setStyle(TextInputStyle.Paragraph).setMaxLength(4000).setRequired(true).setPlaceholder("Embed body...")
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId("embed_color").setLabel("Color (hex e.g. FF5733)").setStyle(TextInputStyle.Short).setMaxLength(7).setRequired(false).setPlaceholder("5865F2")
        )
      );
      return interaction.showModal(modal);
    }

    // ── PIN ────────────────────────────────────────────────
    if (cmd === "pin") {
      const messageId = interaction.options.getString("messageid", true).trim();
      await interaction.deferReply();
      const target = await interaction.channel.messages.fetch(messageId).catch(() => null);
      if (!target) {
        await interaction.editReply("❌ Could not find that message in this channel.");
        scheduleDelete(interaction);
        return;
      }
      await target.pin();
      await interaction.editReply("✅ Message pinned.");
      scheduleDelete(interaction);
      return;
    }

    // ── REACTIONROLES ──────────────────────────────────────
    if (cmd === "reactionroles") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      if (REACTION_ROLES.length === 0) {
        return interaction.editReply("❌ No reaction roles configured. Add some in `REACTION_ROLES` in `bot.js`.");
      }

      const channel = await client.channels.fetch(REACTION_ROLES_CHANNEL_ID).catch(() => null);
      if (!channel?.isTextBased()) {
        return interaction.editReply(`❌ Reaction-roles channel \`${REACTION_ROLES_CHANNEL_ID}\` not found or not text-based.`);
      }

      // Make sure the bot can actually assign every configured role.
      const me = await interaction.guild.members.fetchMe().catch(() => null);
      const missing  = REACTION_ROLES.filter(r => !interaction.guild.roles.cache.has(r.roleId));
      const tooHigh  = me ? REACTION_ROLES.filter(r => {
        const role = interaction.guild.roles.cache.get(r.roleId);
        return role && role.position >= me.roles.highest.position;
      }) : [];
      if (missing.length) {
        return interaction.editReply(`❌ These role IDs don't exist in this server: ${missing.map(r => `\`${r.roleId}\``).join(", ")}`);
      }
      if (tooHigh.length) {
        return interaction.editReply(`❌ My role must be **above** these roles for me to assign them: ${tooHigh.map(r => `**${r.label}**`).join(", ")}. Move my role higher in Server Settings → Roles.`);
      }

      const lines = REACTION_ROLES.map(r =>
        `${r.emoji ? r.emoji + " " : ""}**${r.label}**${r.description ? ` — ${r.description}` : ""}`
      ).join("\n");

      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle("🎭 Self-Assignable Roles")
        .setDescription(
          "Click any button below to **toggle** that role on yourself.\n" +
          "Click the same button again to remove it.\n\n" +
          lines
        )
        .setFooter({ text: "Powered by buttons • Click to toggle" })
        .setTimestamp();

      // Discord caps at 5 buttons per action row, max 5 rows.
      const rows = [];
      for (let i = 0; i < REACTION_ROLES.length && rows.length < 5; i += 5) {
        const row = new ActionRowBuilder().addComponents(
          REACTION_ROLES.slice(i, i + 5).map(r => {
            const btn = new ButtonBuilder()
              .setCustomId(`rr_role:${r.roleId}`)
              .setLabel(r.label)
              .setStyle(r.style ?? ButtonStyle.Secondary);
            if (r.emoji) btn.setEmoji(r.emoji);
            return btn;
          })
        );
        rows.push(row);
      }

      await channel.send({ embeds: [embed], components: rows });
      await interaction.editReply(`✅ Reaction roles posted in ${channel}.`);
      return;
    }

    // ── STOCK (SellAuth storefront) ────────────────────────
    if (cmd === "stock") {
      if (!SELLAUTH_API_KEY) {
        return interaction.reply({
          content: "❌ SellAuth is not configured. An admin needs to set `sellauthApiKey` in `config.json` (and optionally `sellauthShopId`).",
          flags: MessageFlags.Ephemeral,
        });
      }

      const sub      = interaction.options.getSubcommand();
      const override = interaction.options.getChannel?.("channel");
      const targetId = override?.id || storefrontPost?.channelId || SELLAUTH_SALES_CHANNEL_ID;

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      try {
        if (sub === "post") {
          const targetChannel = await interaction.client.channels.fetch(targetId).catch(() => null);
          if (!targetChannel?.isTextBased?.()) {
            return interaction.editReply(`❌ Target channel <#${targetId}> not found or not text-based.`);
          }
          if (storefrontPost) {
            return interaction.editReply(
              `⚠️ A storefront embed already exists in <#${storefrontPost.channelId}>. Use \`/stock refresh\` to update it, or \`/stock remove\` first.`
            );
          }
          const products = await fetchAllSellAuthProducts();
          const embed    = buildStorefrontEmbed(products);
          const msg      = await targetChannel.send({ embeds: [embed] });
          storefrontPost = { channelId: targetChannel.id, messageId: msg.id };
          saveSellAuthState();
          resumeStorefrontAutoRefreshTimer(interaction.client);
          return interaction.editReply(`✅ Posted storefront in ${targetChannel} (${products.length} products). [Jump](${msg.url})`);
        }

        if (sub === "refresh") {
          if (!storefrontPost) {
            return interaction.editReply("❌ No storefront has been posted yet. Use `/stock post` first.");
          }
          const ch  = await interaction.client.channels.fetch(storefrontPost.channelId).catch(() => null);
          const msg = await ch?.messages.fetch(storefrontPost.messageId).catch(() => null);
          if (!msg) {
            storefrontPost = null;
            saveSellAuthState();
            return interaction.editReply("❌ The old storefront message was deleted. Tracking cleared — use `/stock post` to post a new one.");
          }
          const products = await fetchAllSellAuthProducts();
          const embed    = buildStorefrontEmbed(products);
          await msg.edit({ embeds: [embed] });
          resumeStorefrontAutoRefreshTimer(interaction.client);
          return interaction.editReply(`✅ Refreshed storefront (${products.length} products). [Jump](${msg.url})`);
        }

        if (sub === "remove") {
          if (!storefrontPost) {
            return interaction.editReply("❌ No storefront is currently tracked.");
          }
          const ch  = await interaction.client.channels.fetch(storefrontPost.channelId).catch(() => null);
          const msg = await ch?.messages.fetch(storefrontPost.messageId).catch(() => null);
          await msg?.delete().catch(() => {});
          storefrontPost = null;
          saveSellAuthState();
          return interaction.editReply("✅ Storefront embed removed.");
        }
      } catch (err) {
        console.error("/stock error:", err);
        return interaction.editReply(`❌ Something went wrong: ${err.message}`);
      }
      return;
    }

    // ── QUOTE (Finnhub) ────────────────────────────────────
    if (cmd === "quote") {
      if (!FINNHUB_API_KEY) {
        return interaction.reply({
          content: "❌ Stock lookup is not configured. An admin needs to set `FINNHUB_API_KEY` in `config.json` or as an env var.",
          flags: MessageFlags.Ephemeral,
        });
      }

      const symbol = interaction.options.getString("symbol", true).trim().toUpperCase();
      if (!/^[A-Z.\-]{1,10}$/.test(symbol)) {
        return interaction.reply({ content: "❌ Invalid ticker. Use letters only, e.g. `TSLA`.", flags: MessageFlags.Ephemeral });
      }

      await interaction.deferReply();

      try {
        const [quoteRes, profileRes] = await Promise.all([
          fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${FINNHUB_API_KEY}`),
          fetch(`https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(symbol)}&token=${FINNHUB_API_KEY}`),
        ]);

        if (quoteRes.status === 401 || quoteRes.status === 403) {
          await interaction.editReply("❌ Stock API key is invalid or unauthorized.");
          return;
        }
        if (quoteRes.status === 429) {
          await interaction.editReply("❌ Stock API rate limit hit — try again in a moment.");
          return;
        }

        const quote   = await quoteRes.json().catch(() => null);
        const profile = await profileRes.json().catch(() => ({}));

        // Finnhub returns c=0 for unknown symbols.
        if (!quote || !quote.c || quote.c === 0) {
          await interaction.editReply(`❌ No data found for \`${symbol}\`. Double-check the ticker.`);
          return;
        }

        const fmt = n => Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const change   = Number(quote.d  || 0);
        const changePc = Number(quote.dp || 0);
        const isUp     = change >= 0;
        const arrow    = isUp ? "🟢 ▲" : "🔴 ▼";
        const color    = isUp ? 0x16a34a : 0xdc2626;
        const name     = profile?.name || symbol;

        const embed = new EmbedBuilder()
          .setColor(color)
          .setTitle(`${name} (${symbol})`)
          .setURL(profile?.weburl || `https://finance.yahoo.com/quote/${symbol}`)
          .setDescription(`${arrow} **$${fmt(quote.c)}**  (${isUp ? "+" : ""}${fmt(change)} / ${isUp ? "+" : ""}${fmt(changePc)}%)`)
          .addFields(
            { name: "Open",          value: `$${fmt(quote.o)}`,  inline: true },
            { name: "High",          value: `$${fmt(quote.h)}`,  inline: true },
            { name: "Low",           value: `$${fmt(quote.l)}`,  inline: true },
            { name: "Prev. Close",   value: `$${fmt(quote.pc)}`, inline: true },
            { name: "Exchange",      value: profile?.exchange || "—", inline: true },
            { name: "Industry",      value: profile?.finnhubIndustry || "—", inline: true },
          )
          .setFooter({ text: "Source: Finnhub • Data may be delayed" })
          .setTimestamp();

        if (profile?.logo) embed.setThumbnail(profile.logo);

        await interaction.editReply({ embeds: [embed] });
      } catch (err) {
        console.error("Stock lookup error:", err);
        await interaction.editReply("❌ Couldn't fetch stock data right now.");
      }
      return;
    }

  } catch (err) {
    console.error("Interaction error:", err.stack || err);
    const payload = { content: "❌ Something went wrong.", flags: MessageFlags.Ephemeral };
    try {
      if (!interaction.replied && !interaction.deferred) await interaction.reply(payload);
      else if (interaction.deferred) await interaction.editReply(payload);
    } catch { /* ignore */ }
  }
});

// ============================================================
// MODAL HANDLERS
// ============================================================
async function handleSuggestionModal(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const suggestion = interaction.fields.getTextInputValue("suggestion_text");
    const channel    = await interaction.client.channels.fetch(SUGGESTION_CHANNEL_ID).catch(() => null);
    if (!channel?.isTextBased()) return interaction.editReply("❌ Suggestion channel not configured.");
    const embed = new EmbedBuilder().setColor(0x5865f2).setTitle("💡 New Suggestion")
      .setDescription(suggestion)
      .addFields(
        { name: "Submitted By", value: `${interaction.user}`, inline: true },
        { name: "User ID",      value: interaction.user.id,   inline: true }
      ).setTimestamp();
    const msg = await channel.send({ embeds: [embed] });
    await msg.react("✅").catch(() => {});
    await msg.react("❌").catch(() => {});
    return interaction.editReply("✅ Suggestion submitted!");
  } catch (err) {
    console.error("Suggestion modal error:", err);
    return interaction.editReply("❌ Failed to submit suggestion.");
  }
}

async function handleFeedbackModal(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const rating = Number(interaction.fields.getTextInputValue("feedback_rating").trim());
    const text   = interaction.fields.getTextInputValue("feedback_text").trim();
    if (!Number.isInteger(rating) || rating < 1 || rating > 10) {
      return interaction.editReply("❌ Rating must be a whole number from 1 to 10.");
    }
    const channel = await interaction.client.channels.fetch(FEEDBACK_CHANNEL_ID).catch(() => null);
    if (!channel?.isTextBased()) return interaction.editReply("❌ Feedback channel not configured.");
    await channel.send({
      embeds: [new EmbedBuilder().setColor(0x2ecc71).setTitle("📝 New Feedback")
        .addFields(
          { name: "Rating",       value: `${rating}/10`,        inline: true },
          { name: "Submitted By", value: `${interaction.user}`, inline: true },
          { name: "User ID",      value: interaction.user.id,   inline: true },
          { name: "Feedback",     value: text }
        ).setTimestamp()],
    });
    return interaction.editReply("✅ Feedback submitted. Thank you!");
  } catch (err) {
    console.error("Feedback modal error:", err);
    return interaction.editReply("❌ Failed to submit feedback.");
  }
}

async function handleAnnounceModal(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const title     = interaction.fields.getTextInputValue("announce_title").trim();
    const body      = interaction.fields.getTextInputValue("announce_body").trim();
    const channelId = consumeTarget(interaction.user.id, "announce");
    if (!channelId) return interaction.editReply("❌ Session expired. Run `/announce` again.");
    const channel   = await interaction.client.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased()) return interaction.editReply("❌ Could not find that channel.");
    await channel.send({
      embeds: [new EmbedBuilder().setColor(0xe67e22).setTitle(title).setDescription(body)
        .setFooter({ text: `Announced by ${interaction.user.tag}` }).setTimestamp()],
    });
    return interaction.editReply(`✅ Announcement sent to ${channel}.`);
  } catch (err) {
    console.error("Announce modal error:", err);
    return interaction.editReply("❌ Failed to send announcement.");
  }
}

async function handleEmbedModal(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const title       = interaction.fields.getTextInputValue("embed_title").trim();
    const description = interaction.fields.getTextInputValue("embed_description").trim();
    const colorHex    = interaction.fields.getTextInputValue("embed_color").trim() || "5865F2";
    const channelId   = consumeTarget(interaction.user.id, "embed");
    if (!channelId) return interaction.editReply("❌ Session expired. Run `/embed` again.");
    const color       = parseInt(colorHex.replace("#", ""), 16);
    const channel     = await interaction.client.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased()) return interaction.editReply("❌ Could not find that channel.");
    await channel.send({
      embeds: [new EmbedBuilder().setColor(isNaN(color) ? 0x5865f2 : color).setTitle(title).setDescription(description).setTimestamp()],
    });
    return interaction.editReply(`✅ Embed sent to ${channel}.`);
  } catch (err) {
    console.error("Embed modal error:", err);
    return interaction.editReply("❌ Failed to send embed.");
  }
}

// ============================================================
// GLOBAL ERROR GUARD
// ============================================================
client.on(Events.Error, err => console.error("Client error:", err));
process.on("unhandledRejection", err => console.error("Unhandled rejection:", err));
process.on("uncaughtException",  err => console.error("Uncaught exception:", err));

// ============================================================
// READY
// Use Events.ClientReady so this works on both pre-14.21 ('ready')
// and 14.21+ ('clientReady') without code changes.
// ============================================================
client.once(Events.ClientReady, async (readyClient) => {
  loadVerifiedOrders();
  loadWarnings();
  loadGiveaways();
  await scheduleGiveaways(readyClient);
  console.log(`✅ Logged in as ${readyClient.user.tag}`);
  await registerCommands();
  loadSellAuthState();
  startStorefrontAutoRefresh(readyClient);
  console.log("🚀 Bot is fully online and ready");
});

// ============================================================
// GRACEFUL SHUTDOWN
// ============================================================
function shutdown(signal) {
  console.log(`\n⏹️  ${signal} received, shutting down...`);
  if (storefrontAutoRefreshIntervalId !== null) {
    clearInterval(storefrontAutoRefreshIntervalId);
    storefrontAutoRefreshIntervalId = null;
  }
  client.destroy().finally(() => process.exit(0));
  // Hard-exit fallback in case destroy hangs.
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on("SIGINT",  () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

// ============================================================
// LOGIN
// ============================================================
client.login(TOKEN).catch(err => {
  console.error("❌ Login failed:", err);
  process.exit(1);
});