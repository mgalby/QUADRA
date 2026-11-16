import { ICON_NAMES } from './iconNames';

// Ricerca delle icone: tutte le Phosphor per nome inglese, più parole chiave
// italiane per quelle di uso comune (deciso con Marco il 16 novembre 2026).

/** Icona → parole italiane con cui trovarla. L'ordine è anche quello proposto senza ricerca. */
export const IT_WORDS: Record<string, string> = {
  // casa
  house: 'casa abitazione', 'house-line': 'casa abitazione', buildings: 'condominio palazzo edificio', couch: 'divano mobili arredamento casa',
  bed: 'letto camera dormire hotel', bathtub: 'bagno vasca', lightning: 'bollette luce elettricita energia corrente', drop: 'acqua goccia bolletta',
  fire: 'gas fuoco riscaldamento', 'wifi-high': 'internet wifi rete connessione', phone: 'telefono chiamata', 'device-mobile': 'cellulare telefono smartphone',
  wrench: 'riparazioni manutenzione attrezzi idraulico', hammer: 'lavori bricolage martello ristrutturazione', 'paint-roller': 'imbianchino pittura lavori',
  broom: 'pulizie scopa', 'washing-machine': 'lavatrice lavanderia bucato', lamp: 'lampada luce arredamento', key: 'chiave affitto', plant: 'pianta giardino verde',
  flower: 'fiori giardino', armchair: 'poltrona arredamento mobili', 'trash': 'rifiuti spazzatura tari', toolbox: 'attrezzi ferramenta',
  // spesa e cibo
  'shopping-cart': 'spesa supermercato carrello alimentari', basket: 'spesa cestino alimentari', 'shopping-bag': 'acquisti shopping negozio borsa',
  storefront: 'negozio bottega mercato', 'fork-knife': 'ristorante cena pranzo mangiare', pizza: 'pizza pizzeria', hamburger: 'panino fast food hamburger',
  coffee: 'caffe bar colazione', martini: 'aperitivo cocktail bar drink', 'beer-stein': 'birra pub', wine: 'vino enoteca', 'cooking-pot': 'cucina pentola cucinare',
  bread: 'pane panetteria forno', 'ice-cream': 'gelato gelateria', cake: 'torta dolci pasticceria compleanno', carrot: 'verdura ortofrutta', fish: 'pesce pescheria',
  'orange-slice': 'frutta arancia', egg: 'uova', cookie: 'biscotti dolci merenda', 'bowl-food': 'pasto ciotola pranzo', 'tea-bag': 'te tisana',
  // mobilità
  car: 'auto macchina automobile', 'car-profile': 'auto macchina automobile', 'gas-pump': 'benzina carburante gasolio distributore rifornimento',
  'charging-station': 'ricarica elettrica colonnina', bus: 'autobus bus trasporti pullman', train: 'treno ferrovia', tram: 'tram metro',
  subway: 'metro metropolitana', taxi: 'taxi', bicycle: 'bici bicicletta', motorcycle: 'moto motocicletta', scooter: 'scooter monopattino motorino',
  airplane: 'aereo volo viaggi', 'airplane-tilt': 'aereo volo viaggio partenza', boat: 'barca traghetto nave', 'road-horizon': 'autostrada pedaggio strada casello',
  'letter-circle-p': 'parcheggio sosta', garage: 'garage box officina', tire: 'gomme pneumatici gommista', engine: 'motore meccanico officina tagliando',
  'traffic-cone': 'lavori strada multa', 'map-pin': 'luogo posizione mappa', 'map-trifold': 'mappa cartina viaggio', compass: 'bussola escursione orientamento',
  // famiglia e animali
  'users-three': 'famiglia gruppo persone', users: 'persone coppia', baby: 'bambino neonato figlio', 'baby-carriage': 'passeggino neonato bambino',
  student: 'ragazzi studente figli scuola', backpack: 'zaino scuola', gift: 'regalo regali', cat: 'gatto animali', dog: 'cane animali',
  'paw-print': 'animali zampa veterinario', bone: 'cane osso animali', bird: 'uccello animali', rabbit: 'coniglio animali', horse: 'cavallo equitazione',
  heart: 'cuore amore', 'hand-heart': 'beneficenza donazione offerta', balloon: 'festa compleanno palloncino', confetti: 'festa party',
  // persona
  user: 'persona', 't-shirt': 'abbigliamento vestiti maglietta', pants: 'pantaloni abbigliamento', dress: 'vestito abito abbigliamento',
  sneaker: 'scarpe sneakers', 'coat-hanger': 'abbigliamento vestiti lavanderia gruccia', 'first-aid-kit': 'salute medico farmacia pronto soccorso',
  pill: 'farmaci medicine farmacia pillola', stethoscope: 'medico dottore visita', tooth: 'dentista denti', eyeglasses: 'occhiali ottico vista',
  heartbeat: 'salute cuore analisi', hospital: 'ospedale clinica', syringe: 'vaccino analisi iniezione', sparkle: 'cura persona bellezza estetica',
  scissors: 'parrucchiere barbiere capelli forbici', 'hair-dryer': 'parrucchiere capelli phon', 'hand-soap': 'igiene sapone',
  barbell: 'palestra sport pesi fitness', 'person-simple-run': 'corsa sport correre', 'person-simple-swim': 'nuoto piscina', 'person-simple-bike': 'ciclismo bici sport',
  'person-simple-hike': 'trekking escursione montagna camminata', 'person-simple-ski': 'sci neve montagna', 'soccer-ball': 'calcio stadio pallone partita',
  'tennis-ball': 'tennis padel', basketball: 'basket pallacanestro', volleyball: 'pallavolo volley', watch: 'orologio', 'diamond': 'gioielli gioielleria',
  // tempo libero
  ticket: 'eventi biglietto cultura concerto', 'film-slate': 'cinema film', popcorn: 'cinema popcorn', 'mask-happy': 'teatro spettacolo maschera',
  'music-notes': 'musica concerto', guitar: 'chitarra musica strumento', headphones: 'cuffie musica ascolto', 'vinyl-record': 'vinile disco musica',
  'microphone-stage': 'concerto karaoke palco', 'television-simple': 'tv televisione streaming abbonamenti', 'monitor-play': 'streaming video abbonamento',
  'game-controller': 'videogiochi gaming giochi', 'puzzle-piece': 'giochi puzzle hobby', books: 'libri libreria lettura', 'book-open': 'libro lettura',
  newspaper: 'giornale edicola rivista quotidiano', 'paint-brush': 'pittura arte hobby', palette: 'arte pittura colori', 'beach-ball': 'spiaggia mare vacanza',
  umbrella: 'ombrello pioggia', tent: 'campeggio tenda', mountains: 'montagna escursione', island: 'mare isola vacanza', suitcase: 'valigia viaggio vacanza',
  'suitcase-rolling': 'valigia viaggio trolley', bank: 'banca spese bancarie museo', 'park': 'parco giardino', 'tree': 'albero natura',
  // passioni e tecnologia
  camera: 'fotografia macchina fotografica foto', aperture: 'fotografia obiettivo diaframma', 'film-strip': 'pellicola rullino analogico video',
  image: 'foto immagine stampa', 'video-camera': 'video riprese telecamera', laptop: 'computer pc portatile tech', desktop: 'computer pc fisso',
  'device-tablet': 'tablet ipad', printer: 'stampante stampa', 'hard-drives': 'disco archiviazione nas', cpu: 'elettronica processore tech hardware',
  robot: 'intelligenza artificiale ai robot', cloud: 'cloud abbonamento online', code: 'software sviluppo programmazione', plug: 'elettronica spina cavi',
  'graduation-cap': 'formazione corso studio universita scuola', chalkboard: 'lezione corso scuola', certificate: 'attestato certificato corso',
  pencil: 'cancelleria matita scuola', 'paperclip': 'cancelleria ufficio',
  // obblighi e finanza
  scales: 'obblighi legale bilancia giustizia avvocato', receipt: 'tasse scontrino ricevuta imposte', 'warning-circle': 'multa sanzione attenzione',
  gavel: 'legale tribunale avvocato', 'identification-card': 'documenti carta identita patente', stamp: 'bollo marca timbro', shield: 'assicurazione protezione',
  'shield-check': 'assicurazione polizza', 'credit-card': 'carta di credito pagamento', wallet: 'portafoglio entrate soldi',
  money: 'contanti soldi banconote', coins: 'monete soldi risparmi', 'piggy-bank': 'risparmi salvadanaio', 'hand-coins': 'rimborso prestito mancia',
  briefcase: 'lavoro stipendio ufficio', 'chart-line-up': 'investimenti rendimenti borsa', 'trend-up': 'investimenti crescita', percent: 'interessi sconto percentuale',
  tag: 'vendite usato prezzo etichetta', handshake: 'accordo vendita affare', invoice: 'fattura parcella', calculator: 'commercialista calcolo conti',
  'currency-eur': 'euro valuta', 'currency-dollar': 'dollaro valuta', envelope: 'posta lettera spedizione', package: 'pacco spedizione corriere consegna',
  truck: 'trasporto consegna corriere trasloco', cigarette: 'fumo sigarette tabacco', 'dots-three': 'altro varie',
  question: 'altro varie sconosciuto', star: 'preferiti speciale', 'calendar-blank': 'calendario scadenza', clock: 'tempo orario', church: 'chiesa offerta',
  'globe-hemisphere-west': 'mondo estero viaggio', translate: 'lingue corso traduzione', 'swimming-pool': 'piscina nuoto', 'bowling-ball': 'bowling',
  'dice-five': 'giochi dadi scommesse', 'cards': 'carte giochi', lego: 'giochi giocattoli lego', 'flower-lotus': 'benessere yoga spa relax',
};

const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

const KNOWN = new Set(ICON_NAMES);
/** Le icone proposte quando non si cerca nulla. */
export const COMMON_ICONS: string[] = Object.keys(IT_WORDS).filter((n) => KNOWN.has(n));

/**
 * Cerca le icone: prima quelle con una parola italiana che inizia come il testo,
 * poi quelle il cui nome inglese lo contiene. Senza testo propone le più comuni.
 */
export function searchIcons(query: string): string[] {
  const q = fold(query);
  if (q === '') return COMMON_ICONS;
  const terms = q.split(/\s+/);
  const italian = COMMON_ICONS.filter((name) => {
    const words = fold(IT_WORDS[name]).split(' ');
    return terms.every((term) => words.some((w) => w.startsWith(term)));
  });
  const seen = new Set(italian);
  const english = ICON_NAMES.filter((name) => !seen.has(name) && terms.every((term) => name.includes(term)));
  // i nomi che iniziano con il testo prima di quelli che lo contengono soltanto
  english.sort((a, b) => Number(b.startsWith(q)) - Number(a.startsWith(q)) || a.localeCompare(b));
  return [...italian, ...english];
}

export const iconExists = (name: string) => KNOWN.has(name);
