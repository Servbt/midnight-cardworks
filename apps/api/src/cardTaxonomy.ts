// GENERATED FILE — do not edit by hand.
//
// Card type and colour identity for every listing, so the storefront can tag and filter by them.
// Derived from Scryfall's oracle-card bulk data: each listing title is matched to a real card by
// the longest leading run of words that is a card name, then that card's authoritative type_line
// and colour_identity are reduced to one type word and one colour word.
//
// How to refresh it after the catalogue changes: pull a fresh oracle-cards bulk file from
// https://api.scryfall.com/bulk-data (the oracle_cards JSONL) and re-run the derivation above
// against the current etsyCatalogue.ts. Matching rule: take the longest leading run of words in
// the listing title that is a card name in that file, ignoring the storefront's own wording
// ("Proxy", "Proxy Card", "- <theme> Inspired", "V1/V2"). A hand-written checked-in script for
// this is a follow-up; it is deliberately not claimed here until it exists.
//
// Listings that are not a single card - token packs and land sets - carry their own type and are
// given no colour, rather than being forced into a card type they are not. Commissions are not
// listed here at all: a commission is a kind of product rather than a card, so it is a category
// on the storefront instead of a card type, and a listing with no entry simply carries no type.

export const CARD_TYPES = ['Creature', 'Instant', 'Sorcery', 'Enchantment', 'Artifact', 'Land',
  'Planeswalker', 'Battle', 'Token', 'Set'] as const;
export const COLOUR_IDENTITIES = ['White', 'Blue', 'Black', 'Red', 'Green', 'Multicolour', 'Colorless'] as const;

export type CardType = (typeof CARD_TYPES)[number];
export type ColourIdentity = (typeof COLOUR_IDENTITIES)[number];

/** The type/colour facets a listing is filtered by. colour is absent when a listing has none. */
export interface CardFacets {
  type: CardType;
  colour?: ColourIdentity;
}

export const cardTaxonomy: Record<string, CardFacets> = {
  'force-of-will-proxy-card': { type: 'Instant', colour: 'Blue' },
  'temporal-manipulation': { type: 'Sorcery', colour: 'Blue' },
  'serras-sanctum': { type: 'Land', colour: 'White' },
  'lions-eye-diamond-proxy': { type: 'Artifact', colour: 'Colorless' },
  'city-of-brass-proxy-card': { type: 'Land', colour: 'Colorless' },
  'goblin-bombardment-proxy': { type: 'Enchantment', colour: 'Red' },
  'exploration-proxy': { type: 'Enchantment', colour: 'Green' },
  'argothian-enchantress-v2': { type: 'Creature', colour: 'Green' },
  'delighted-halfling': { type: 'Creature', colour: 'Green' },
  'smothering-tithe-proxy': { type: 'Enchantment', colour: 'White' },
  'yawgmoths-will': { type: 'Sorcery', colour: 'Black' },
  'orims-chant-proxy': { type: 'Instant', colour: 'White' },
  'chrome-mox-proxy': { type: 'Artifact', colour: 'Colorless' },
  'culling-the-weak-proxy': { type: 'Instant', colour: 'Black' },
  'coat-of-arms-proxy': { type: 'Artifact', colour: 'Colorless' },
  'corpse-dance-proxy': { type: 'Instant', colour: 'Black' },
  'mox-amber-proxy': { type: 'Artifact', colour: 'Colorless' },
  'sapphire-medallion-proxy': { type: 'Artifact', colour: 'Colorless' },
  'medallion-proxy-set': { type: 'Set' },
  'steal-enchantment-proxy': { type: 'Enchantment', colour: 'Blue' },
  'propaganda-enchantment-proxy': { type: 'Enchantment', colour: 'Blue' },
  'intuition-proxy': { type: 'Instant', colour: 'Blue' },
  'burgeoning-proxy': { type: 'Enchantment', colour: 'Green' },
  'birds-of-paradise-proxy': { type: 'Creature', colour: 'Green' },
  'red-elemental-blast-proxy': { type: 'Instant', colour: 'Red' },
  'jet-medallion-proxy': { type: 'Artifact', colour: 'Colorless' },
  'silence-proxy': { type: 'Instant', colour: 'White' },
  'underground-sea-tloz-botw-proxy-card': { type: 'Land', colour: 'Multicolour' },
  'volcanic-island-tloz-ww-proxy-card': { type: 'Land', colour: 'Multicolour' },
  'earthcraft-proxy': { type: 'Enchantment', colour: 'Green' },
  'tymna-and-thrasios-proxies': { type: 'Creature', colour: 'Multicolour' },
  'pearl-medallion-proxy': { type: 'Artifact', colour: 'Colorless' },
  'island-proxy': { type: 'Land', colour: 'Blue' },
  'lotus-petal-proxy': { type: 'Artifact', colour: 'Colorless' },
  'mox-diamond-proxy': { type: 'Artifact', colour: 'Colorless' },
  'forest-proxy': { type: 'Land', colour: 'Green' },
  'elvish-spirit-guide-proxy': { type: 'Creature', colour: 'Green' },
  'rain-of-filth-proxy': { type: 'Instant', colour: 'Black' },
  'voltaic-key': { type: 'Artifact', colour: 'Colorless' },
  'wasteland-proxy': { type: 'Land', colour: 'Colorless' },
  'mystic-remora-proxies': { type: 'Enchantment', colour: 'Blue' },
  'tundra-dual-land-proxy-card': { type: 'Land', colour: 'Multicolour' },
  'plateau-dual-land-proxy': { type: 'Land', colour: 'Multicolour' },
  'windfall-proxy': { type: 'Sorcery', colour: 'Blue' },
  'earthcraft-v2-proxy': { type: 'Enchantment', colour: 'Green' },
  'midna-treasure-token': { type: 'Token', colour: 'Colorless' },
  'food-token': { type: 'Token', colour: 'Colorless' },
  'intuition-proxy-2': { type: 'Instant', colour: 'Blue' },
  'necropotence-proxy': { type: 'Enchantment', colour: 'Black' },
  'wheel-of-fortune-proxy': { type: 'Sorcery', colour: 'Red' },
  'ancient-tomb-proxy': { type: 'Land', colour: 'Colorless' },
  'volraths-stronghold': { type: 'Land', colour: 'Black' },
  'tloz-dual-lands-set': { type: 'Set' },
  'phyrexian-tower-proxy': { type: 'Land', colour: 'Black' },
  'ancient-tomb-proxy-2': { type: 'Land', colour: 'Colorless' },
  'mox-opal-proxy': { type: 'Artifact', colour: 'Colorless' },
  'sneak-attack-proxy': { type: 'Enchantment', colour: 'Red' },
  'altar-of-dementia-proxy': { type: 'Artifact', colour: 'Colorless' },
  'windfall-proxy-v2': { type: 'Sorcery', colour: 'Blue' },
  'null-rod-proxy': { type: 'Artifact', colour: 'Colorless' },
  'emerald-medallion-proxy': { type: 'Artifact', colour: 'Colorless' },
  'mirris-guile-proxy': { type: 'Enchantment', colour: 'Green' },
  'swords-to-plowshares-proxy': { type: 'Instant', colour: 'White' },
  'savannah-dual-land-proxy-card': { type: 'Land', colour: 'Multicolour' },
  'horn-of-greed-proxy': { type: 'Artifact', colour: 'Colorless' },
  'mystical-tutor-proxy': { type: 'Instant', colour: 'Blue' },
  'clue-token': { type: 'Token', colour: 'Colorless' },
  'grave-pact-proxy': { type: 'Enchantment', colour: 'Black' },
  'final-fortune-proxy': { type: 'Instant', colour: 'Red' },
  'firestorm-proxy': { type: 'Instant', colour: 'Red' },
  'gaeas-cradle': { type: 'Land', colour: 'Green' },
  'cursed-totem-proxy': { type: 'Artifact', colour: 'Colorless' },
  'esper-sentinel-proxy': { type: 'Creature', colour: 'White' },
  'dark-ritual-proxy': { type: 'Instant', colour: 'Black' },
  'priest-of-titania-proxy': { type: 'Creature', colour: 'Green' },
  'carpet-of-flowers-proxy': { type: 'Enchantment', colour: 'Green' },
  'survival-of-the-fittest': { type: 'Enchantment', colour: 'Green' },
  'argothian-enchantress-v1': { type: 'Creature', colour: 'Green' },
  'gilded-drake': { type: 'Creature', colour: 'Blue' },
  'demonic-consultation-proxy': { type: 'Instant', colour: 'Black' },
  'time-spiral-night': { type: 'Sorcery', colour: 'Blue' },
  'time-spiral-day': { type: 'Sorcery', colour: 'Blue' },
  'survival-of-the-fittest-v2': { type: 'Enchantment', colour: 'Green' },
  'lotus-petal-proxy-2': { type: 'Artifact', colour: 'Colorless' },
  'sol-ring-proxy': { type: 'Artifact', colour: 'Colorless' },
  'ruby-medallion-proxy': { type: 'Artifact', colour: 'Colorless' },
  'doomsday-proxy': { type: 'Sorcery', colour: 'Black' },
  'land-tax-proxy': { type: 'Enchantment', colour: 'White' },
  'reanimate-proxy': { type: 'Sorcery', colour: 'Black' },
  'blood-moon-proxy': { type: 'Enchantment', colour: 'Red' },
  'demonic-tutor-proxy': { type: 'Sorcery', colour: 'Black' },
  'swamp-proxy': { type: 'Land', colour: 'Black' },
  'tropical-island-dual-land-proxy': { type: 'Land', colour: 'Multicolour' },
  'lands-set': { type: 'Set' },
  'sliver-queen-token-proxies': { type: 'Creature', colour: 'Multicolour' },
  'worldly-tutor-proxy': { type: 'Instant', colour: 'Green' },
  'vampiric-tutor-proxy': { type: 'Instant', colour: 'Black' },
  'token-set': { type: 'Token', colour: 'Colorless' },
  'scrubland-tloz-tp-inspired-fan-art': { type: 'Land', colour: 'Multicolour' },
  'bayou-tloz-tp-inspired-fan-art': { type: 'Land', colour: 'Multicolour' },
  'taiga-dual-land-proxy': { type: 'Land', colour: 'Multicolour' },
  'enlightened-tutor-proxy': { type: 'Instant', colour: 'White' },
  'lions-eye-diamond-proxy-v2': { type: 'Artifact', colour: 'Colorless' },
  'gamble-proxy': { type: 'Sorcery', colour: 'Red' },
  'treasure-token': { type: 'Token', colour: 'Colorless' },
  'plains-proxy': { type: 'Land', colour: 'White' },
  'mountain-proxy': { type: 'Land', colour: 'Red' },
  'basalt-monolith-proxy': { type: 'Artifact', colour: 'Colorless' },
  'scroll-rack-proxy': { type: 'Artifact', colour: 'Colorless' },
  'sacrifice-proxy': { type: 'Instant', colour: 'Black' },
  'gemstone-mine': { type: 'Land', colour: 'Colorless' },
  'reanimate-proxy-2': { type: 'Sorcery', colour: 'Black' },
  'transmute-artifact': { type: 'Sorcery', colour: 'Blue' },
  'badlands-dual-land-proxy': { type: 'Land', colour: 'Multicolour' },
};
