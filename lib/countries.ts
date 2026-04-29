/**
 * ISO 3166-1 alpha-3 country codes mapped to localized country names (fr/en/de).
 * Single source of truth for nationality / country fields across the entire app
 * (admin, candidate dashboard, CV builder).
 *
 * Rule: never display the ISO code or German adjective form to users —
 * always display the country NAME in the active UI language.
 */

export type CountryNames = { fr: string; en: string; de: string };

export const COUNTRY_MAP: Record<string, CountryNames> = {
  // ── Africa ────────────────────────────────────────────────────────────────
  MAR: { fr: "Maroc",               en: "Morocco",              de: "Marokko" },
  DZA: { fr: "Algérie",             en: "Algeria",              de: "Algerien" },
  TUN: { fr: "Tunisie",             en: "Tunisia",              de: "Tunesien" },
  EGY: { fr: "Égypte",              en: "Egypt",                de: "Ägypten" },
  LBY: { fr: "Libye",               en: "Libya",                de: "Libyen" },
  SEN: { fr: "Sénégal",             en: "Senegal",              de: "Senegal" },
  NGA: { fr: "Nigéria",             en: "Nigeria",              de: "Nigeria" },
  GHA: { fr: "Ghana",               en: "Ghana",                de: "Ghana" },
  MLI: { fr: "Mali",                en: "Mali",                 de: "Mali" },
  MRT: { fr: "Mauritanie",          en: "Mauritania",           de: "Mauretanien" },
  CIV: { fr: "Côte d'Ivoire",       en: "Ivory Coast",          de: "Elfenbeinküste" },
  CMR: { fr: "Cameroun",            en: "Cameroon",             de: "Kamerun" },
  COD: { fr: "Rép. Dém. du Congo",  en: "DR Congo",             de: "DR Kongo" },
  COG: { fr: "Congo",               en: "Congo",                de: "Kongo" },
  ETH: { fr: "Éthiopie",            en: "Ethiopia",             de: "Äthiopien" },
  KEN: { fr: "Kenya",               en: "Kenya",                de: "Kenia" },
  TZA: { fr: "Tanzanie",            en: "Tanzania",             de: "Tansania" },
  UGA: { fr: "Ouganda",             en: "Uganda",               de: "Uganda" },
  ZAF: { fr: "Afrique du Sud",      en: "South Africa",         de: "Südafrika" },
  SDN: { fr: "Soudan",              en: "Sudan",                de: "Sudan" },
  SOM: { fr: "Somalie",             en: "Somalia",              de: "Somalia" },
  GIN: { fr: "Guinée",              en: "Guinea",               de: "Guinea" },
  BFA: { fr: "Burkina Faso",        en: "Burkina Faso",         de: "Burkina Faso" },
  NER: { fr: "Niger",               en: "Niger",                de: "Niger" },
  TCD: { fr: "Tchad",               en: "Chad",                 de: "Tschad" },
  AGO: { fr: "Angola",              en: "Angola",               de: "Angola" },
  MOZ: { fr: "Mozambique",          en: "Mozambique",           de: "Mosambik" },
  ZMB: { fr: "Zambie",              en: "Zambia",               de: "Sambia" },
  ZWE: { fr: "Zimbabwe",            en: "Zimbabwe",             de: "Simbabwe" },
  BWA: { fr: "Botswana",            en: "Botswana",             de: "Botswana" },
  NAM: { fr: "Namibie",             en: "Namibia",              de: "Namibia" },
  MWI: { fr: "Malawi",              en: "Malawi",               de: "Malawi" },
  RWA: { fr: "Rwanda",              en: "Rwanda",               de: "Ruanda" },
  BDI: { fr: "Burundi",             en: "Burundi",              de: "Burundi" },
  DJI: { fr: "Djibouti",            en: "Djibouti",             de: "Dschibuti" },
  ERI: { fr: "Érythrée",            en: "Eritrea",              de: "Eritrea" },
  GMB: { fr: "Gambie",              en: "Gambia",               de: "Gambia" },
  SLE: { fr: "Sierra Leone",        en: "Sierra Leone",         de: "Sierra Leone" },
  LBR: { fr: "Libéria",             en: "Liberia",              de: "Liberia" },
  BEN: { fr: "Bénin",               en: "Benin",                de: "Benin" },
  TGO: { fr: "Togo",                en: "Togo",                 de: "Togo" },
  GAB: { fr: "Gabon",               en: "Gabon",                de: "Gabun" },
  GNQ: { fr: "Guinée équatoriale",  en: "Equatorial Guinea",    de: "Äquatorialguinea" },
  CAF: { fr: "Rép. Centrafricaine", en: "Central African Rep.", de: "Zentralafrikanische Republik" },
  MDG: { fr: "Madagascar",          en: "Madagascar",           de: "Madagaskar" },
  MUS: { fr: "Maurice",             en: "Mauritius",            de: "Mauritius" },
  SWZ: { fr: "Eswatini",            en: "Eswatini",             de: "Eswatini" },
  LSO: { fr: "Lesotho",             en: "Lesotho",              de: "Lesotho" },
  CPV: { fr: "Cap-Vert",            en: "Cape Verde",           de: "Kap Verde" },
  GNB: { fr: "Guinée-Bissau",       en: "Guinea-Bissau",        de: "Guinea-Bissau" },
  COM: { fr: "Comores",             en: "Comoros",              de: "Komoren" },
  STP: { fr: "Sao Tomé-et-Principe",en: "São Tomé & Príncipe",  de: "São Tomé und Príncipe" },
  SYC: { fr: "Seychelles",          en: "Seychelles",           de: "Seychellen" },

  // ── Middle East ───────────────────────────────────────────────────────────
  SYR: { fr: "Syrie",               en: "Syria",                de: "Syrien" },
  LBN: { fr: "Liban",               en: "Lebanon",              de: "Libanon" },
  JOR: { fr: "Jordanie",            en: "Jordan",               de: "Jordanien" },
  PSE: { fr: "Palestine",           en: "Palestine",            de: "Palästina" },
  IRQ: { fr: "Irak",                en: "Iraq",                 de: "Irak" },
  IRN: { fr: "Iran",                en: "Iran",                 de: "Iran" },
  SAU: { fr: "Arabie saoudite",     en: "Saudi Arabia",         de: "Saudi-Arabien" },
  ARE: { fr: "Émirats arabes unis", en: "UAE",                  de: "Vereinigte Arabische Emirate" },
  QAT: { fr: "Qatar",               en: "Qatar",                de: "Katar" },
  KWT: { fr: "Koweït",              en: "Kuwait",               de: "Kuwait" },
  BHR: { fr: "Bahreïn",             en: "Bahrain",              de: "Bahrain" },
  OMN: { fr: "Oman",                en: "Oman",                 de: "Oman" },
  YEM: { fr: "Yémen",               en: "Yemen",                de: "Jemen" },

  // ── Europe ────────────────────────────────────────────────────────────────
  FRA: { fr: "France",              en: "France",               de: "Frankreich" },
  DEU: { fr: "Allemagne",           en: "Germany",              de: "Deutschland" },
  ESP: { fr: "Espagne",             en: "Spain",                de: "Spanien" },
  ITA: { fr: "Italie",              en: "Italy",                de: "Italien" },
  GBR: { fr: "Royaume-Uni",         en: "United Kingdom",       de: "Vereinigtes Königreich" },
  PRT: { fr: "Portugal",            en: "Portugal",             de: "Portugal" },
  BEL: { fr: "Belgique",            en: "Belgium",              de: "Belgien" },
  NLD: { fr: "Pays-Bas",            en: "Netherlands",          de: "Niederlande" },
  LUX: { fr: "Luxembourg",          en: "Luxembourg",           de: "Luxemburg" },
  CHE: { fr: "Suisse",              en: "Switzerland",          de: "Schweiz" },
  AUT: { fr: "Autriche",            en: "Austria",              de: "Österreich" },
  GRC: { fr: "Grèce",               en: "Greece",               de: "Griechenland" },
  TUR: { fr: "Turquie",             en: "Turkey",               de: "Türkei" },
  POL: { fr: "Pologne",             en: "Poland",               de: "Polen" },
  CZE: { fr: "Tchéquie",            en: "Czech Republic",       de: "Tschechien" },
  SVK: { fr: "Slovaquie",           en: "Slovakia",             de: "Slowakei" },
  HUN: { fr: "Hongrie",             en: "Hungary",              de: "Ungarn" },
  ROU: { fr: "Roumanie",            en: "Romania",              de: "Rumänien" },
  BGR: { fr: "Bulgarie",            en: "Bulgaria",             de: "Bulgarien" },
  HRV: { fr: "Croatie",             en: "Croatia",              de: "Kroatien" },
  SRB: { fr: "Serbie",              en: "Serbia",               de: "Serbien" },
  MNE: { fr: "Monténégro",          en: "Montenegro",           de: "Montenegro" },
  BIH: { fr: "Bosnie-Herzégovine",  en: "Bosnia & Herzegovina", de: "Bosnien und Herzegowina" },
  ALB: { fr: "Albanie",             en: "Albania",              de: "Albanien" },
  MKD: { fr: "Macédoine du Nord",   en: "North Macedonia",      de: "Nordmazedonien" },
  SVN: { fr: "Slovénie",            en: "Slovenia",             de: "Slowenien" },
  LTU: { fr: "Lituanie",            en: "Lithuania",            de: "Litauen" },
  LVA: { fr: "Lettonie",            en: "Latvia",               de: "Lettland" },
  EST: { fr: "Estonie",             en: "Estonia",              de: "Estland" },
  FIN: { fr: "Finlande",            en: "Finland",              de: "Finnland" },
  SWE: { fr: "Suède",               en: "Sweden",               de: "Schweden" },
  NOR: { fr: "Norvège",             en: "Norway",               de: "Norwegen" },
  DNK: { fr: "Danemark",            en: "Denmark",              de: "Dänemark" },
  ISL: { fr: "Islande",             en: "Iceland",              de: "Island" },
  IRL: { fr: "Irlande",             en: "Ireland",              de: "Irland" },
  MLT: { fr: "Malte",               en: "Malta",                de: "Malta" },
  CYP: { fr: "Chypre",              en: "Cyprus",               de: "Zypern" },
  RUS: { fr: "Russie",              en: "Russia",               de: "Russland" },
  UKR: { fr: "Ukraine",             en: "Ukraine",              de: "Ukraine" },
  BLR: { fr: "Biélorussie",         en: "Belarus",              de: "Weißrussland" },
  MDA: { fr: "Moldavie",            en: "Moldova",              de: "Moldau" },
  GEO: { fr: "Géorgie",             en: "Georgia",              de: "Georgien" },
  ARM: { fr: "Arménie",             en: "Armenia",              de: "Armenien" },
  AZE: { fr: "Azerbaïdjan",         en: "Azerbaijan",           de: "Aserbaidschan" },

  // ── Central Asia ─────────────────────────────────────────────────────────
  KAZ: { fr: "Kazakhstan",          en: "Kazakhstan",           de: "Kasachstan" },
  UZB: { fr: "Ouzbékistan",         en: "Uzbekistan",           de: "Usbekistan" },
  TKM: { fr: "Turkménistan",        en: "Turkmenistan",         de: "Turkmenistan" },
  KGZ: { fr: "Kirghizistan",        en: "Kyrgyzstan",           de: "Kirgisistan" },
  TJK: { fr: "Tadjikistan",         en: "Tajikistan",           de: "Tadschikistan" },

  // ── Asia ──────────────────────────────────────────────────────────────────
  PAK: { fr: "Pakistan",            en: "Pakistan",             de: "Pakistan" },
  IND: { fr: "Inde",                en: "India",                de: "Indien" },
  BGD: { fr: "Bangladesh",          en: "Bangladesh",           de: "Bangladesch" },
  NPL: { fr: "Népal",               en: "Nepal",                de: "Nepal" },
  LKA: { fr: "Sri Lanka",           en: "Sri Lanka",            de: "Sri Lanka" },
  AFG: { fr: "Afghanistan",         en: "Afghanistan",          de: "Afghanistan" },
  MMR: { fr: "Myanmar",             en: "Myanmar",              de: "Myanmar" },
  THA: { fr: "Thaïlande",           en: "Thailand",             de: "Thailand" },
  VNM: { fr: "Viêt Nam",            en: "Vietnam",              de: "Vietnam" },
  KHM: { fr: "Cambodge",            en: "Cambodia",             de: "Kambodscha" },
  MYS: { fr: "Malaisie",            en: "Malaysia",             de: "Malaysia" },
  SGP: { fr: "Singapour",           en: "Singapore",            de: "Singapur" },
  IDN: { fr: "Indonésie",           en: "Indonesia",            de: "Indonesien" },
  PHL: { fr: "Philippines",         en: "Philippines",          de: "Philippinen" },
  CHN: { fr: "Chine",               en: "China",                de: "China" },
  JPN: { fr: "Japon",               en: "Japan",                de: "Japan" },
  KOR: { fr: "Corée du Sud",        en: "South Korea",          de: "Südkorea" },
  MNG: { fr: "Mongolie",            en: "Mongolia",             de: "Mongolei" },

  // ── Americas ──────────────────────────────────────────────────────────────
  USA: { fr: "États-Unis",          en: "United States",        de: "Vereinigte Staaten" },
  CAN: { fr: "Canada",              en: "Canada",               de: "Kanada" },
  MEX: { fr: "Mexique",             en: "Mexico",               de: "Mexiko" },
  BRA: { fr: "Brésil",              en: "Brazil",               de: "Brasilien" },
  ARG: { fr: "Argentine",           en: "Argentina",            de: "Argentinien" },
  CHL: { fr: "Chili",               en: "Chile",                de: "Chile" },
  COL: { fr: "Colombie",            en: "Colombia",             de: "Kolumbien" },
  PER: { fr: "Pérou",               en: "Peru",                 de: "Peru" },
  VEN: { fr: "Venezuela",           en: "Venezuela",            de: "Venezuela" },
  ECU: { fr: "Équateur",            en: "Ecuador",              de: "Ecuador" },
  BOL: { fr: "Bolivie",             en: "Bolivia",              de: "Bolivien" },
  PRY: { fr: "Paraguay",            en: "Paraguay",             de: "Paraguay" },
  URY: { fr: "Uruguay",             en: "Uruguay",              de: "Uruguay" },
  GTM: { fr: "Guatemala",           en: "Guatemala",            de: "Guatemala" },
  CUB: { fr: "Cuba",                en: "Cuba",                 de: "Kuba" },
  DOM: { fr: "Rép. Dominicaine",    en: "Dominican Republic",   de: "Dominikanische Republik" },
  HTI: { fr: "Haïti",               en: "Haiti",                de: "Haiti" },

  // ── Oceania ───────────────────────────────────────────────────────────────
  AUS: { fr: "Australie",           en: "Australia",            de: "Australien" },
  NZL: { fr: "Nouvelle-Zélande",    en: "New Zealand",          de: "Neuseeland" },
};

/**
 * German nationality adjective → ISO code.
 * Used only for backward-compat with old DB rows that stored German adjectives
 * (e.g. "marokkanisch") instead of ISO codes.
 */
export const ADJ_TO_ISO: Record<string, string> = {
  "marokkanisch":"MAR","algerisch":"DZA","tunesisch":"TUN","ägyptisch":"EGY","libysisch":"LBY",
  "syrisch":"SYR","libanesisch":"LBN","jordanisch":"JOR","irakisch":"IRQ","iranisch":"IRN",
  "senegalesisch":"SEN","nigerianisch":"NGA","ghanaisch":"GHA","malisch":"MLI","mauretanisch":"MRT",
  "palästinensisch":"PSE","pakistanisch":"PAK","indisch":"IND","philippinisch":"PHL",
  "französisch":"FRA","deutsch":"DEU","spanisch":"ESP","italienisch":"ITA","britisch":"GBR",
  "türkisch":"TUR","russisch":"RUS","ukrainisch":"UKR","polnisch":"POL","tschechisch":"CZE",
  "amerikanisch":"USA","kanadisch":"CAN","brasilianisch":"BRA","australisch":"AUS",
  "südafrikanisch":"ZAF","äthiopisch":"ETH","kamerunisch":"CMR","ivorisch":"CIV",
  "saudi-arabisch":"SAU","emiratisch":"ARE","armenisch":"ARM",
  "georgisch":"GEO","aserbaidschanisch":"AZE","kasachisch":"KAZ","usbekisch":"UZB",
  "afgahnisch":"AFG","afghanisch":"AFG","chinesisch":"CHN","japanisch":"JPN",
  "südkoreanisch":"KOR","vietnamesisch":"VNM","indonesisch":"IDN","malaysisch":"MYS",
  "bangladeschisch":"BGD","nepalesisch":"NPL","mexikanisch":"MEX","argentinisch":"ARG",
};

/**
 * Resolve any stored value (ISO code, country name in any language, or
 * legacy German adjective) into the country name in the target language.
 * Returns "" for null/empty input. Returns the raw value if it cannot be
 * resolved (so we never lose data).
 */
export function natToLang(value: string | null | undefined, target: "fr"|"en"|"de"): string {
  if (!value) return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  const up = trimmed.toUpperCase();
  // 1. ISO code
  if (COUNTRY_MAP[up]) return COUNTRY_MAP[up][target];
  // 2. Country name in any language
  for (const names of Object.values(COUNTRY_MAP)) {
    if ([names.fr, names.en, names.de].some(n => n.toLowerCase() === trimmed.toLowerCase())) {
      return names[target];
    }
  }
  // 3. Legacy German adjective
  const iso = ADJ_TO_ISO[trimmed.toLowerCase()];
  if (iso && COUNTRY_MAP[iso]) return COUNTRY_MAP[iso][target];
  // 4. Unknown — return as typed
  return trimmed;
}

/** ISO 3166-1 alpha-3 → alpha-2 (lowercase) for flag CDN URLs. */
export const ISO3_TO_ISO2: Record<string, string> = {
  MAR:"ma", DZA:"dz", TUN:"tn", EGY:"eg", LBY:"ly", SEN:"sn", NGA:"ng", GHA:"gh", MLI:"ml", MRT:"mr",
  CIV:"ci", CMR:"cm", COD:"cd", COG:"cg", ETH:"et", KEN:"ke", TZA:"tz", UGA:"ug", ZAF:"za", SDN:"sd",
  SOM:"so", GIN:"gn", BFA:"bf", NER:"ne", TCD:"td", AGO:"ao", MOZ:"mz", ZMB:"zm", ZWE:"zw", BWA:"bw",
  NAM:"na", MWI:"mw", RWA:"rw", BDI:"bi", DJI:"dj", ERI:"er", GMB:"gm", SLE:"sl", LBR:"lr", BEN:"bj",
  TGO:"tg", GAB:"ga", GNQ:"gq", CAF:"cf", MDG:"mg", MUS:"mu", SWZ:"sz", LSO:"ls", CPV:"cv", GNB:"gw",
  COM:"km", STP:"st", SYC:"sc",
  SYR:"sy", LBN:"lb", JOR:"jo", PSE:"ps", IRQ:"iq", IRN:"ir", SAU:"sa", ARE:"ae", QAT:"qa", KWT:"kw",
  BHR:"bh", OMN:"om", YEM:"ye",
  FRA:"fr", DEU:"de", ESP:"es", ITA:"it", GBR:"gb", PRT:"pt", BEL:"be", NLD:"nl", LUX:"lu", CHE:"ch",
  AUT:"at", GRC:"gr", TUR:"tr", POL:"pl", CZE:"cz", SVK:"sk", HUN:"hu", ROU:"ro", BGR:"bg", HRV:"hr",
  SRB:"rs", MNE:"me", BIH:"ba", ALB:"al", MKD:"mk", SVN:"si", LTU:"lt", LVA:"lv", EST:"ee", FIN:"fi",
  SWE:"se", NOR:"no", DNK:"dk", ISL:"is", IRL:"ie", MLT:"mt", CYP:"cy",
  RUS:"ru", UKR:"ua", BLR:"by", MDA:"md", GEO:"ge", ARM:"am", AZE:"az", KAZ:"kz", UZB:"uz", TKM:"tm",
  KGZ:"kg", TJK:"tj",
  PAK:"pk", IND:"in", BGD:"bd", NPL:"np", LKA:"lk", AFG:"af", MMR:"mm", THA:"th", VNM:"vn", KHM:"kh",
  MYS:"my", SGP:"sg", IDN:"id", PHL:"ph", CHN:"cn", JPN:"jp", KOR:"kr", MNG:"mn",
  USA:"us", CAN:"ca", MEX:"mx", BRA:"br", ARG:"ar", CHL:"cl", COL:"co", PER:"pe", VEN:"ve", ECU:"ec",
  BOL:"bo", PRY:"py", URY:"uy", GTM:"gt", CUB:"cu", DOM:"do", HTI:"ht",
  AUS:"au", NZL:"nz",
};

/** ISO 3166-1 alpha-3 → international dialing code (E.164 prefix). */
export const ISO3_TO_PHONE: Record<string, string> = {
  // Africa
  MAR:"+212", DZA:"+213", TUN:"+216", EGY:"+20",  LBY:"+218", SEN:"+221", NGA:"+234", GHA:"+233",
  MLI:"+223", MRT:"+222", CIV:"+225", CMR:"+237", COD:"+243", COG:"+242", ETH:"+251", KEN:"+254",
  TZA:"+255", UGA:"+256", ZAF:"+27",  SDN:"+249", SOM:"+252", GIN:"+224", BFA:"+226", NER:"+227",
  TCD:"+235", AGO:"+244", MOZ:"+258", ZMB:"+260", ZWE:"+263", BWA:"+267", NAM:"+264", MWI:"+265",
  RWA:"+250", BDI:"+257", DJI:"+253", ERI:"+291", GMB:"+220", SLE:"+232", LBR:"+231", BEN:"+229",
  TGO:"+228", GAB:"+241", GNQ:"+240", CAF:"+236", MDG:"+261", MUS:"+230", SWZ:"+268", LSO:"+266",
  CPV:"+238", GNB:"+245", COM:"+269", STP:"+239", SYC:"+248",
  // MENA / Middle East
  SYR:"+963", LBN:"+961", JOR:"+962", PSE:"+970", IRQ:"+964", IRN:"+98",  SAU:"+966", ARE:"+971",
  QAT:"+974", KWT:"+965", BHR:"+973", OMN:"+968", YEM:"+967",
  // Europe
  FRA:"+33",  DEU:"+49",  ESP:"+34",  ITA:"+39",  GBR:"+44",  PRT:"+351", BEL:"+32",  NLD:"+31",
  LUX:"+352", CHE:"+41",  AUT:"+43",  GRC:"+30",  TUR:"+90",  POL:"+48",  CZE:"+420", SVK:"+421",
  HUN:"+36",  ROU:"+40",  BGR:"+359", HRV:"+385", SRB:"+381", MNE:"+382", BIH:"+387", ALB:"+355",
  MKD:"+389", SVN:"+386", LTU:"+370", LVA:"+371", EST:"+372", FIN:"+358", SWE:"+46",  NOR:"+47",
  DNK:"+45",  ISL:"+354", IRL:"+353", MLT:"+356", CYP:"+357",
  // Eastern Europe / Central Asia
  RUS:"+7",   UKR:"+380", BLR:"+375", MDA:"+373", GEO:"+995", ARM:"+374", AZE:"+994", KAZ:"+7",
  UZB:"+998", TKM:"+993", KGZ:"+996", TJK:"+992",
  // Asia
  PAK:"+92",  IND:"+91",  BGD:"+880", NPL:"+977", LKA:"+94",  AFG:"+93",  MMR:"+95",  THA:"+66",
  VNM:"+84",  KHM:"+855", MYS:"+60",  SGP:"+65",  IDN:"+62",  PHL:"+63",  CHN:"+86",  JPN:"+81",
  KOR:"+82",  MNG:"+976",
  // Americas
  USA:"+1",   CAN:"+1",   MEX:"+52",  BRA:"+55",  ARG:"+54",  CHL:"+56",  COL:"+57",  PER:"+51",
  VEN:"+58",  ECU:"+593", BOL:"+591", PRY:"+595", URY:"+598", GTM:"+502", CUB:"+53",  DOM:"+1",
  HTI:"+509",
  // Oceania
  AUS:"+61",  NZL:"+64",
};

/** Sorted dropdown options for the active UI language. */
export function countryOptions(lang: "fr"|"en"|"de"): { iso: string; label: string }[] {
  return Object.entries(COUNTRY_MAP)
    .map(([iso, names]) => ({ iso, label: names[lang] }))
    .sort((a, b) => a.label.localeCompare(b.label));
}
