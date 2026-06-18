// Seed artists for the BPM index crawler.
//
// FULL_CATALOG  -> walk every album (and features) — "literally everything".
// ROCK_BANDS / POP_ARTISTS / RAP_ARTISTS / ELECTRONIC_ARTISTS -> top songs each,
// kept roughly balanced so the catalogue has good coverage of running music.

export const FULL_CATALOG = [
  "Eminem",
  "Slipknot",
  "Metallica",
  "Foo Fighters",
  "Nirvana",
  "System of a Down",
  "Gojira",
];

export const ROCK_BANDS = [
  // classic / hard rock
  "The Beatles", "The Rolling Stones", "Led Zeppelin", "Pink Floyd", "Queen",
  "The Who", "The Doors", "Jimi Hendrix", "Cream", "The Kinks",
  "Black Sabbath", "Deep Purple", "AC/DC", "Aerosmith", "Lynyrd Skynyrd",
  "Fleetwood Mac", "Eagles", "Bruce Springsteen", "Tom Petty and the Heartbreakers",
  "Creedence Clearwater Revival", "ZZ Top", "Thin Lizzy", "The Allman Brothers Band",
  "Kiss", "Whitesnake",
  // 80s rock / glam / arena
  "Van Halen", "Guns N' Roses", "Bon Jovi", "Def Leppard", "Mötley Crüe",
  "Scorpions", "Journey", "Boston", "Kansas", "Twisted Sister",
  // prog / new wave / post-punk
  "Rush", "Yes", "Genesis", "The Police", "U2", "Dire Straits",
  "R.E.M.", "The Smiths", "The Cure", "Depeche Mode", "Talking Heads",
  "Joy Division",
  // punk
  "The Clash", "Ramones", "Sex Pistols", "Green Day", "The Offspring",
  "Blink-182", "Sum 41", "Refused",
  // grunge / alt 90s
  "Pearl Jam", "Soundgarden", "Alice in Chains", "Stone Temple Pilots",
  "Red Hot Chili Peppers", "Smashing Pumpkins", "Radiohead", "Oasis", "Blur",
  "Weezer", "Pixies", "Sonic Youth",
  // metal / thrash / classic metal
  "Iron Maiden", "Judas Priest", "Motörhead", "Dio", "Ozzy Osbourne",
  "Pantera", "Megadeth", "Slayer", "Anthrax",
  // nu / alt metal / metalcore
  "Rage Against the Machine", "Nine Inch Nails", "Tool", "A Perfect Circle",
  "Korn", "Deftones", "Linkin Park", "Disturbed", "Godsmack", "Stone Sour",
  "Avenged Sevenfold", "Bullet for My Valentine", "Trivium", "Killswitch Engage",
  "Lamb of God", "Mastodon", "Parkway Drive", "Bring Me the Horizon", "Architects",
  // modern / garage / indie rock
  "Muse", "Arctic Monkeys", "The Strokes", "The White Stripes", "The Black Keys",
  "Queens of the Stone Age", "Kings of Leon", "Incubus", "Coldplay",
  "Audioslave", "Velvet Revolver", "Faith No More", "Ghost", "Opeth",
];

export const POP_ARTISTS = [
  // legends
  "Michael Jackson", "Madonna", "Prince", "Whitney Houston", "Mariah Carey",
  "Janet Jackson", "George Michael", "Elton John", "Stevie Wonder", "ABBA",
  "Bee Gees", "Cyndi Lauper", "Tina Turner", "Phil Collins", "Hall & Oates",
  // 2000s pop
  "Britney Spears", "Christina Aguilera", "Backstreet Boys", "*NSYNC",
  "Spice Girls", "Gwen Stefani", "No Doubt", "Nelly Furtado", "Robbie Williams",
  "Black Eyed Peas", "Pitbull", "Flo Rida", "Usher", "Chris Brown", "Ne-Yo",
  "Jason Derulo",
  // modern pop / chart
  "Beyoncé", "Rihanna", "Lady Gaga", "Katy Perry", "Taylor Swift",
  "Ariana Grande", "Justin Timberlake", "Justin Bieber", "Bruno Mars",
  "Ed Sheeran", "Adele", "Dua Lipa", "The Weeknd", "Billie Eilish",
  "Harry Styles", "Olivia Rodrigo", "Doja Cat", "SZA", "Sabrina Carpenter",
  "Charlie Puth", "Shawn Mendes", "Sia", "P!nk", "Kelly Clarkson",
  "Avril Lavigne", "Kesha", "Lizzo", "Miley Cyrus", "Demi Lovato",
  "Selena Gomez", "Camila Cabello", "Halsey", "Lorde", "Lana Del Rey",
  "Meghan Trainor", "Ava Max", "Bebe Rexha", "Anne-Marie", "Zara Larsson",
  "Tove Lo", "Carly Rae Jepsen", "Sam Smith", "Hozier", "Lewis Capaldi",
  "Charli XCX", "Troye Sivan", "Jonas Brothers",
  // pop-rock / hype crossover
  "Maroon 5", "OneRepublic", "Imagine Dragons", "twenty one pilots",
  "Panic! at the Disco", "Fall Out Boy", "Paramore", "Florence + the Machine",
  "The Chainsmokers",
];

export const RAP_ARTISTS = [
  // Eminem-adjacent (kept from before)
  "Dr. Dre", "50 Cent", "D12", "Royce da 5'9\"", "Bad Meets Evil",
  "Obie Trice", "Yelawolf", "Tech N9ne", "Hopsin", "NF", "Joyner Lucas", "Logic",
  // legends / golden era
  "2Pac", "The Notorious B.I.G.", "Snoop Dogg", "JAY-Z", "Nas",
  "Ice Cube", "N.W.A", "Run-DMC", "Beastie Boys", "Public Enemy",
  "Wu-Tang Clan", "OutKast", "Missy Elliott", "Busta Rhymes", "DMX",
  "Method Man", "Redman", "Cypress Hill", "House of Pain", "Bone Thugs-n-Harmony",
  "Three 6 Mafia", "Mos Def", "Talib Kweli", "Common",
  // 2000s / 2010s
  "Kanye West", "Kendrick Lamar", "Drake", "J. Cole", "Lil Wayne",
  "Kid Cudi", "Childish Gambino", "Mac Miller", "Wiz Khalifa", "Ludacris",
  "T.I.", "Rick Ross", "Meek Mill", "Big Sean", "2 Chainz", "Gucci Mane",
  "Macklemore", "Joey Bada$$", "Vince Staples", "ScHoolboy Q", "Pusha T",
  "Freddie Gibbs",
  // modern / trap / drill
  "Travis Scott", "Future", "Post Malone", "21 Savage", "Lil Baby",
  "DaBaby", "Megan Thee Stallion", "Cardi B", "Nicki Minaj", "Lil Uzi Vert",
  "Juice WRLD", "XXXTENTACION", "Pop Smoke", "Roddy Ricch", "Denzel Curry",
  "Run the Jewels", "Playboi Carti", "Polo G", "Jack Harlow", "Lil Durk",
  "Don Toliver", "Baby Keem", "JID",
];

// EDM — the stuff that actually makes you run. Deep coverage across the
// sub-genres: big-room/festival, house/tech-house, dubstep/bass, drum & bass,
// trance, future-bass/melodic, and the breaks/electro classics.
export const EDM_ARTISTS = [
  // breaks / electro classics
  "The Prodigy", "The Chemical Brothers", "Fatboy Slim", "The Crystal Method",
  "Daft Punk", "Justice", "deadmau5", "Wolfgang Gartner", "Porter Robinson",
  "Madeon", "Feed Me", "Pegboard Nerds", "The Glitch Mob",
  // big-room / festival / progressive house
  "Calvin Harris", "David Guetta", "Avicii", "Swedish House Mafia", "Tiësto",
  "Martin Garrix", "Hardwell", "Afrojack", "Steve Aoki",
  "Dimitri Vegas & Like Mike", "Don Diablo", "Alesso", "Axwell & Ingrosso",
  "Zedd", "Kygo", "Robin Schulz", "R3HAB", "Galantis", "Eric Prydz",
  // house / tech-house
  "Fisher", "Chris Lake", "John Summit", "CamelPhat", "Gorgon City",
  "Duke Dumont", "MK", "Kaytranada", "Disclosure",
  // dubstep / bass
  "Skrillex", "Knife Party", "Excision", "Subtronics", "Zomboy",
  "Virtual Riot", "Flux Pavilion", "Nero", "Doctor P", "Datsik", "Getter",
  "Rusko", "Modestep",
  // drum & bass
  "Pendulum", "Chase & Status", "Sub Focus", "Wilkinson", "Netsky", "Andy C",
  "Dimension", "Koven", "High Contrast", "Camo & Krooked", "Noisia", "Hybrid Minds",
  // trance
  "Armin van Buuren", "Above & Beyond", "Paul van Dyk", "Ferry Corsten",
  "Gareth Emery",
  // future bass / melodic / festival-melodic
  "Flume", "ODESZA", "RÜFÜS DU SOL", "Illenium", "Seven Lions", "San Holo",
  "Said the Sky", "Gryffin", "Slander", "Jai Wolf", "Major Lazer", "Marshmello",
];

// Heavy metal — 100 bands across the sub-genres: classic/NWOBHM, thrash, death,
// black, doom/sludge, power/prog/symphonic, groove/nu, and modern metalcore.
export const METAL_ARTISTS = [
  // classic / NWOBHM / heavy
  "Black Sabbath", "Judas Priest", "Iron Maiden", "Motörhead", "Dio",
  "Ozzy Osbourne", "Saxon", "Diamond Head", "Accept", "Manowar",
  "Mercyful Fate", "King Diamond", "Rainbow", "W.A.S.P.", "Dokken",
  // thrash
  "Megadeth", "Slayer", "Anthrax", "Testament", "Exodus", "Overkill",
  "Kreator", "Sodom", "Destruction", "Sepultura", "Death Angel", "Annihilator",
  // death
  "Death", "Cannibal Corpse", "Morbid Angel", "Obituary", "Deicide",
  "Entombed", "Carcass", "At the Gates", "Bolt Thrower", "Nile", "Behemoth",
  "Suffocation", "Cattle Decapitation", "Decapitated", "Amon Amarth",
  "Children of Bodom", "Arch Enemy", "In Flames", "Soilwork", "Dark Tranquillity",
  // black
  "Mayhem", "Emperor", "Darkthrone", "Immortal", "Bathory", "Dimmu Borgir",
  "Satyricon", "Watain", "Gorgoroth", "Marduk",
  // doom / sludge / stoner
  "Candlemass", "Electric Wizard", "Sleep", "Kyuss", "Saint Vitus", "Down",
  "Crowbar", "Pentagram",
  // power / prog / symphonic
  "Helloween", "Blind Guardian", "Gamma Ray", "Stratovarius", "Sonata Arctica",
  "Nightwish", "Symphony X", "Dream Theater", "Queensrÿche", "Fates Warning",
  "Kamelot", "DragonForce", "HammerFall", "Sabaton", "Powerwolf", "Epica",
  "Within Temptation", "Therion", "Angra", "Avantasia",
  // groove / nu / industrial
  "Machine Head", "DevilDriver", "Fear Factory", "Soulfly", "Static-X",
  "Mudvayne", "Sevendust", "Five Finger Death Punch", "Rob Zombie", "Ministry",
  // modern / metalcore / tech
  "As I Lay Dying", "August Burns Red", "Unearth", "The Black Dahlia Murder",
  "Whitechapel", "Meshuggah", "Periphery", "Animals as Leaders",
];

// Genre tag stored on each crawled track (the artist's bucket, not iTunes' tag).
export const GENRE_OF = {};
for (const a of [...FULL_CATALOG, ...ROCK_BANDS]) GENRE_OF[a] = "rock";
for (const a of POP_ARTISTS) GENRE_OF[a] = "pop";
for (const a of RAP_ARTISTS) GENRE_OF[a] = "rap";
for (const a of EDM_ARTISTS) GENRE_OF[a] = "edm";
for (const a of METAL_ARTISTS) GENRE_OF[a] = "metal"; // override: e.g. Black Sabbath → metal, not rock
GENRE_OF["Eminem"] = "rap"; // full-catalog, but a rap artist not a rock band
