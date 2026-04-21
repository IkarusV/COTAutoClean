/*
 * Think Block Cleaner — SillyTavern Extension
 *
 * Automatically strips leftover <think>...</think> blocks from messages
 * after they finish generating/streaming. SillyTavern's built-in reasoning
 * parser only handles the FIRST <think> block at the start of each message.
 * If the model outputs additional thinking blocks mid-message, they leak
 * into the visible text. This extension catches those leftovers.
 *
 * - Hooks into MESSAGE_RECEIVED (fires once the message is done streaming)
 * - Scans the message for any <think>...</think> blocks
 * - Strips them silently, updates the display, and saves the chat
 * - Also provides a manual "Scan All" button in extension settings
 */

import { extension_settings, getContext } from "../../../extensions.js";
import {
    updateMessageBlock,
    event_types,
    eventSource,
    chat,
    saveChatDebounced,
    saveSettingsDebounced,
} from "../../../../script.js";

const extensionName = "SillyTavern-ThinkCleaner";
const LOG_PREFIX = "[ThinkCleaner]";

// ─── Settings ───────────────────────────────────────────────────────────────

const defaultSettings = {
    enabled: true,
    logRemovals: true,
    thinkPrefix: "<think>",
    thinkSuffix: "</think>",
};

function loadSettings() {
    if (!extension_settings[extensionName]) {
        extension_settings[extensionName] = {};
    }
    // Backfill any missing keys from defaults
    extension_settings[extensionName] = Object.assign(
        {},
        defaultSettings,
        extension_settings[extensionName],
    );
    return extension_settings[extensionName];
}

function getSettings() {
    return extension_settings[extensionName] ?? defaultSettings;
}

// ─── Core Logic ─────────────────────────────────────────────────────────────

/**
 * Escapes a string for safe use inside a RegExp.
 */
function escapeForRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Builds regex patterns dynamically from the configured prefix/suffix.
 * Returns { closedRegex, unclosedRegex }.
 */
function buildThinkRegex() {
    const settings = getSettings();
    const prefix = escapeForRegex(settings.thinkPrefix);
    const suffix = escapeForRegex(settings.thinkSuffix);

    // Match closed blocks: <think>...</think>
    const closedRegex = new RegExp(`${prefix}[\\s\\S]*?${suffix}`, "gi");
    // Match unclosed blocks at end of message: <think>...EOF
    const unclosedRegex = new RegExp(`${prefix}[\\s\\S]*$`, "gi");

    return { closedRegex, unclosedRegex };
}

/**
 * Strip all think blocks from a string using the configured tags.
 * Returns { cleaned, count } where count = number of blocks removed.
 */
function stripThinkBlocks(text) {
    if (!text || typeof text !== "string") {
        return { cleaned: text, count: 0 };
    }

    const { closedRegex, unclosedRegex } = buildThinkRegex();
    let count = 0;

    // First: remove all fully closed blocks
    const closedMatches = text.match(closedRegex);
    if (closedMatches) {
        count += closedMatches.length;
    }
    let cleaned = text.replace(closedRegex, "");

    // Second: remove any unclosed block at the end
    const unclosedMatches = cleaned.match(unclosedRegex);
    if (unclosedMatches) {
        count += unclosedMatches.length;
    }
    cleaned = cleaned.replace(unclosedRegex, "");

    // Clean up any resulting double-newlines or leading/trailing whitespace artifacts
    cleaned = cleaned.replace(/\n{3,}/g, "\n\n").trim();

    return { cleaned, count };
}

/**
 * Process a single message by ID — strip think blocks and update if needed.
 * @param {number} messageId
 * @param {object} [options]
 * @param {boolean} [options.persist=true] Whether to save chat after cleaning
 * @returns {boolean} true if the message was modified
 */
function cleanMessage(messageId, { persist = true } = {}) {
    const settings = getSettings();
    if (!settings.enabled) return false;

    if (!Array.isArray(chat) || messageId < 0 || messageId >= chat.length) {
        return false;
    }

    const message = chat[messageId];
    if (!message || !message.mes) return false;

    // Skip user messages — only clean AI responses
    if (message.is_user) return false;

    const { cleaned, count } = stripThinkBlocks(message.mes);

    if (count === 0) return false;

    if (settings.logRemovals) {
        console.log(`${LOG_PREFIX} Stripped ${count} ${settings.thinkPrefix} block(s) from message #${messageId}`);
    }

    // Update the message in the chat array
    message.mes = cleaned;

    // Also update the current swipe if swipes exist
    if (Array.isArray(message.swipes) && message.swipe_id !== undefined) {
        message.swipes[message.swipe_id] = cleaned;
    }

    // Re-render the message block in the DOM
    try {
        updateMessageBlock(messageId, message);
    } catch (e) {
        console.warn(`${LOG_PREFIX} Could not update message block for #${messageId}:`, e);
    }

    if (persist) {
        saveChatDebounced();
    }

    return true;
}

/**
 * Scan ALL messages in the current chat and clean them.
 * @returns {number} How many messages were cleaned
 */
function cleanAllMessages() {
    if (!Array.isArray(chat)) return 0;

    let cleanedCount = 0;
    for (let i = 0; i < chat.length; i++) {
        if (cleanMessage(i, { persist: false })) {
            cleanedCount++;
        }
    }

    if (cleanedCount > 0) {
        saveChatDebounced();
    }

    return cleanedCount;
}

// ─── Event Hooks ────────────────────────────────────────────────────────────

/**
 * Called when a message is fully received (done streaming).
 * The event passes (messageId, type).
 */
function onMessageReceived(messageId) {
    const settings = getSettings();
    if (!settings.enabled) return;

    // Small delay to make sure the message is fully saved to the chat array
    setTimeout(() => {
        cleanMessage(messageId);
    }, 100);
}

// ─── UI ─────────────────────────────────────────────────────────────────────

function createSettingsUI() {
    const settings = loadSettings();

    const html = `
    <div id="think-cleaner-settings" class="think-cleaner-settings">
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>Think Block Cleaner</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
                <p class="think-cleaner-desc">
                    Automatically removes leftover thinking blocks from AI messages
                    after generation completes. SillyTavern only parses the 
                    <b>first</b> thinking block — this extension catches any additional ones
                    that leak into the visible text.
                </p>
                <div class="think-cleaner-toggles">
                    <label class="checkbox_label" for="think-cleaner-enabled">
                        <input type="checkbox" id="think-cleaner-enabled" ${settings.enabled ? "checked" : ""} />
                        <span>Enable auto-cleaning</span>
                    </label>
                    <label class="checkbox_label" for="think-cleaner-log">
                        <input type="checkbox" id="think-cleaner-log" ${settings.logRemovals ? "checked" : ""} />
                        <span>Log removals to console</span>
                    </label>
                </div>
                <div class="think-cleaner-tags">
                    <label class="think-cleaner-tag-label">
                        <span>Opening tag</span>
                        <input type="text" id="think-cleaner-prefix" class="text_pole" value="${settings.thinkPrefix}" placeholder="<think>" />
                    </label>
                    <label class="think-cleaner-tag-label">
                        <span>Closing tag</span>
                        <input type="text" id="think-cleaner-suffix" class="text_pole" value="${settings.thinkSuffix}" placeholder="</think>" />
                    </label>
                </div>
                <div class="think-cleaner-info" id="think-cleaner-info"></div>
                <div class="think-cleaner-actions">
                    <button id="think-cleaner-scan-btn" class="menu_button menu_button_icon" title="Scan all messages in this chat and remove think blocks">
                        <i class="fa-solid fa-broom"></i>
                        <span>Scan &amp; Clean All</span>
                    </button>
                </div>
            </div>
        </div>
    </div>`;

    $("#extensions_settings2").append(html);

    // Wire up toggles
    $("#think-cleaner-enabled").on("change", function () {
        const settings = getSettings();
        settings.enabled = !!$(this).prop("checked");
        saveSettingsDebounced();
    });

    $("#think-cleaner-log").on("change", function () {
        const settings = getSettings();
        settings.logRemovals = !!$(this).prop("checked");
        saveSettingsDebounced();
    });

    // Wire up tag inputs
    $("#think-cleaner-prefix").on("input", function () {
        const settings = getSettings();
        settings.thinkPrefix = String($(this).val()).trim() || defaultSettings.thinkPrefix;
        saveSettingsDebounced();
    });

    $("#think-cleaner-suffix").on("input", function () {
        const settings = getSettings();
        settings.thinkSuffix = String($(this).val()).trim() || defaultSettings.thinkSuffix;
        saveSettingsDebounced();
    });

    // Wire up scan button
    $("#think-cleaner-scan-btn").on("click", function () {
        const count = cleanAllMessages();
        const infoEl = document.getElementById("think-cleaner-info");
        if (count === 0) {
            if (infoEl) {
                infoEl.textContent = "✅ No <think> blocks found in any messages.";
                infoEl.className = "think-cleaner-info think-cleaner-info--clean";
            }
            toastr.info("No think blocks found.", "Think Cleaner");
        } else {
            if (infoEl) {
                infoEl.textContent = `🧹 Cleaned ${count} message${count === 1 ? "" : "s"}.`;
                infoEl.className = "think-cleaner-info think-cleaner-info--dirty";
            }
            toastr.success(`Cleaned ${count} message${count === 1 ? "" : "s"}.`, "Think Cleaner");
        }
    });
}

// ─── Init ───────────────────────────────────────────────────────────────────

jQuery(async () => {
    console.log(`${LOG_PREFIX} Extension loaded.`);

    createSettingsUI();

    // Hook into MESSAGE_RECEIVED — fires when a message is done streaming/generating
    eventSource.on(event_types.MESSAGE_RECEIVED, onMessageReceived);

    // Also clean on MESSAGE_EDITED in case an edit re-introduces think blocks
    eventSource.on(event_types.MESSAGE_EDITED, onMessageReceived);

    console.log(`${LOG_PREFIX} Hooks registered.`);
});
