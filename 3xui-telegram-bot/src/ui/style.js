// Simple "glass" (frosted) look simulation for Telegram inline keyboard buttons.
// Telegram does not support real transparency/styling for buttons, so we mimic it
// with decorative characters.

function glassLabel(text) {
  return `░░ ${text} ░░`;
}

function pill(text) {
  return `⟦ ${text} ⟧`;
}

module.exports = { glassLabel, pill };
