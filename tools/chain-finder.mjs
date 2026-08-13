#!/usr/bin/env node
// Enumerate every valid Links chain from a curated compound-phrase graph,
// keeping only those whose acrostic is a real word.
import { readFileSync } from 'node:fs';

// ── curated edges: "A B" is a compound word or rock-solid phrase ──────────
const PAIRS = `
snake oil | oil field | field trip | field work | field day | field goal
small print | print out | out take | out let | out post | out side | out back
out line | out look | out put | out fit | out break | out door | out cast | out number
out going | out right | out law | out rage | out reach | out burst | out weigh
let down | down town | down load | down fall | down pour | down size | down hill
down beat | down grade | down stairs | down time | down side | down stream
black out | black board | black bird | black mail | black smith | black list
check out | check point | check list | check book | check mate | check up
sell out | hand out | drop out | print out | burn out | camp out | cook out
work out | time out | look out | hang out | take out | blow out | knock out
back log | log in | log out | log jam | back up | back fire | back bone | back pack
back ground | back lash | back drop | back hand | back yard | back stage | back seat
back board | back track | back bend | back door | back street
in put | in side | in take | in door | in land | in come | in law | in field | in box
side walk | side kick | side line | side show | side bar | side step | side track
side car | side swipe | side burn
track suit | track record | track star
short hand | short cut | short cake | short stop | short list | short fall
short bread | short change | short sighted
hand book | hand bag | hand shake | hand made | hand rail | hand writing | hand cuff
hand ball | hand stand | hand picked | hand held
book mark | book case | book store | book shelf | book worm | book keeper | book end
mark up | mark down | mark er
up set | up date | up grade | up town | up right | up tight | up load | up side
up hill | up beat | up stairs | up keep | up lift | up root | up stage | up wind
dress up | pick up | push up | make up | break up | build up | pin up | line up
close up | warm up | wash up | round up | stand up | catch up | hook up | mix up
safety pin | pin ball | pin point | pin wheel | pin stripe
strong hold | hold up | hold out | hold over | hold back
head line | head ache | head phone | head light | head start | head stone | head way
head quarters | head band | head count | head first | head hunter
line up | line back | line man | line age
over pass | over time | over board | over load | over head | over look | over coat
over flow | over night | over due | over dose | over haul | over throw | over cast
over kill | over lap | over rule | over sight | over weight | over grown | over run
push over | make over | left over | cross over | hang over | take over | turn over
roll over | pull over | tip over | boil over | stop over | walk over | change over
fire arm | arm rest | arm chair | arm pit | arm band | arm hole
fire fly | fire works | fire place | fire wood | fire man | fire proof | fire wall
fire drill | fire side | fire storm | fire cracker
open fire | camp fire | back fire | cease fire | rapid fire | gun fire | bon fire
flash light | light house | light year | light weight | light bulb | light ning
spot light | day light | moon light | star light | sun light | high light | search light
house work | house hold | house boat | house fly | house wife | house plant | house coat
house keeper | house warming | house broken
work shop | work load | work force | work bench | work book | work horse | work place
work day | work station | work sheet | work flow
team work | net work | home work | fire work | ground work | paper work | guess work
shop lift | shop keeper | shop talk
lift off | off shore | off set | off spring | off beat | off side | off hand | off line
off road | off stage
hot air | fresh air | mid air | open air | thin air
air port | air line | air mail | air time | air bag | air plane | air wave | air fare
air space | air craft | air field | air lift | air borne | air tight
crab apple | bad apple | apple pie | apple tree | apple sauce | apple juice
nest egg | easter egg | egg plant | egg shell | egg head | egg nog | egg white
black eye | eagle eye | private eye | eye ball | eye brow | eye sight | eye lid
eye witness | eye lash | eye glass
black ice | dry ice | ice berg | ice cream | ice box | ice cap | ice pack | ice age
sun set | sun rise | sun flower | sun burn | sun shine | sun light | sun down | sun dial
sun deck | sun room | sun spot | sun screen | sun tan
snow ball | snow flake | snow man | snow storm | snow plow | snow shoe | snow drift
ball park | ball room | ball point | ball game | ball boy
park way | park bench | way side | way point
rain bow | rain coat | rain drop | rain fall | rain forest | rain check | rain water
horse play | horse shoe | horse power | horse back | horse fly | horse radish
play ground | play back | play book | play house | play mate | play off | play pen
play list | play write | play time
ground work | ground hog | ground floor | ground breaking
dog house | dog wood | dog fight | watch dog | guard dog | hot dog | sheep dog
watch man | watch tower | stop watch | night watch
car pool | car port | car wash | car pet | race car | sports car | box car
foot ball | foot print | foot step | foot note | foot hill | foot age | foot path
foot hold | foot work | bare foot
post card | post age | post man | post season | post script | post mark | post war
sign post | goal post | lamp post | bed post
stop watch | stop light | stop gap | stop over | door stop | bus stop | pit stop
water fall | water melon | water proof | water mark | water shed | water front
water way | water color | water logged | water cooler | rain water | salt water
moon light | moon beam | moon shine | moon walk | full moon | honey moon
star fish | star dust | star light | star gaze | rock star | movie star | all star
land mark | land slide | land lord | land scape | land fill | land line | land mine
main land | wonder land | home land | farm land | wet land
key board | key hole | key note | key stone | key word | key pad | key chain
board walk | board room | surf board | dash board | card board | score board
bed room | bed rock | bed time | bed side | bed spread | bed bug | bed sheet
rock band | rock bottom | rock star | rock slide | bed rock | punk rock | hard rock
high way | high light | high land | high chair | high rise | high jump
night fall | night mare | night life | night club | night gown | night cap | night stand
mid night | over night | good night | last night
break down | break through | break fast | break out | break up | break even | break water
fast ball | fast food | fast track | fast lane | fast forward
cut back | cut off | cut out | cut throat | short cut | hair cut | wood cut
set back | set up | set list | up set | sun set | off set | on set | mind set
kick back | kick off | kick stand | side kick | drop kick
point blank | point er | ball point | check point | view point | pin point | stand point
paper back | paper work | paper weight | paper clip | paper trail | paper boy
news paper | wall paper | fly paper | sand paper | note paper
weight lifter | weight room | light weight | over weight | paper weight | dead weight
sand paper | sand box | sand storm | sand bag | sand castle | sand bar | quick sand
box car | box office | box spring | mail box | tool box | sand box | ice box | in box
mail man | mail box | air mail | black mail | e mail | junk mail | voice mail
tooth brush | tooth ache | tooth paste | tooth pick | sweet tooth
brush fire | brush stroke | hair brush | paint brush
hair cut | hair brush | hair line | hair pin | hair spray | hair style | hair do
gold fish | gold mine | gold smith | fish bowl | fish hook | fish net | fish tank
cat fish | jelly fish | star fish | sword fish | sun fish | shell fish
milk shake | milk man | milk maid | hand shake | ground shake
shake down | show down | melt down | count down | crack down | slow down | sit down
show case | show room | show time | show girl | show off | show down | show man
case work | brief case | book case | suit case | stair case | pillow case
suit case | law suit | track suit | swim suit | wet suit | space suit | jump suit
space ship | space craft | space suit | space bar | outer space
ship yard | ship wreck | ship ment | air ship | friend ship | space ship | star ship
yard stick | yard sale | back yard | court yard | junk yard | school yard
stick shift | stick er | chop stick | lip stick | night stick | yard stick
green house | green land | green horn | ever green | putting green
tea pot | tea cup | tea spoon | tea bag | tea time | tea kettle
pot hole | pot luck | pot belly | pot pie | jack pot | flower pot | crock pot
hole punch | punch line | punch bowl | punch card | sucker punch | pot hole | key hole
jack pot | jack knife | jack hammer | car jack | lumber jack | flap jack
hammer head | sledge hammer | jack hammer
mouse trap | mouse pad | trap door | booby trap | sand trap | speed trap
door bell | door step | door way | door knob | door man | door mat | back door
bell hop | bell boy | door bell | dumb bell | blue bell | cow bell
step father | step son | step ladder | door step | foot step | side step | two step
father land | grand father | god father | step father
grand stand | grand son | grand mother | grand parent | grand slam | grand piano
stand still | stand point | stand out | band stand | grand stand | hand stand | night stand
still born | new born | first born
lap top | lap dog | table top | tree top | roof top | hill top | tip top
top soil | top coat | top notch | top side | table top | tank top | big top
soil pipe | pipe line | pipe dream | pipe bomb | bag pipe | wind pipe | tail pipe
dream land | dream boat | day dream | pipe dream | wet dream
boat house | boat yard | house boat | life boat | sail boat | speed boat | tug boat
life boat | life line | life time | life style | life guard | life span | wild life
guard rail | body guard | life guard | security guard | vanguard
rail road | rail way | rail car | hand rail | guard rail | third rail
road block | road side | road trip | road map | road way | rail road | cross road
block buster | block head | road block | sun block | stumbling block | butcher block
cross road | cross walk | cross fire | cross word | cross bow | cross over | rail cross
word play | word smith | cross word | pass word | swear word | buzz word
pass port | pass word | pass over | by pass | over pass | under pass | trespass
port hole | port able | air port | car port | sea port | space port | pass port
sea shell | sea food | sea shore | sea weed | sea sick | sea horse | sea side | sea son
shell fish | shell shock | egg shell | sea shell | nut shell | bomb shell
season ticket | ticket booth | season ing
horn et | fog horn | french horn | shoe horn | green horn | leg horn
shoe lace | shoe horn | shoe string | horse shoe | snow shoe | gum shoe
string bean | string along | shoe string | draw string | heart string
bean bag | bean stalk | jelly bean | coffee bean | has been
bag pipe | bag gage | hand bag | tea bag | sand bag | sleeping bag | air bag
gate way | gate keeper | flood gate | tail gate | water gate
free way | free dom | free lance | free fall | free style | free way | free load
fall out | fall back | night fall | water fall | rain fall | wind fall | pit fall
wind mill | wind pipe | wind shield | wind fall | wind ow | head wind | tail wind
mill stone | wind mill | tread mill | saw mill | run of the mill
stone wall | stone age | corner stone | key stone | grave stone | head stone | lime stone
wall paper | wall flower | wall nut | fire wall | stone wall | dry wall
flower pot | flower bed | sun flower | wall flower | may flower | cauli flower
bed bug | bed rock | bed time | flower bed | river bed | sick bed
bug spray | bed bug | fire bug | litter bug | love bug
spray paint | paint brush | paint ball | war paint | face paint
face book | face lift | face off | face plant | sur face | boldface
lift off | lift er | fork lift | ski lift | shop lift | face lift | air lift
plant er | egg plant | house plant | power plant | trans plant
power plant | power point | power play | power house | horse power | man power | fire power
play off | play pen | pen pal | pen knife | pen name | ball pen | pig pen
pal ace | ace high | pen pal
knife edge | pen knife | jack knife | pocket knife | butter knife
edge wise | knife edge | cutting edge | water edge
pocket book | pocket knife | pocket watch | pick pocket | air pocket
watch dog | watch band | wrist watch | pocket watch | night watch | stop watch
band aid | band stand | band width | head band | rubber band | rock band | wrist band
aid station | first aid | band aid | hearing aid
first aid | first hand | first born | first class | head first
class room | class mate | class act | first class | middle class | world class
room mate | room service | bed room | class room | court room | dark room | leg room
mate ship | class mate | room mate | ship mate | play mate | check mate | soul mate
service man | service station | room service | lip service | self service | secret service
station wagon | gas station | fire station | space station | police station | work station
wagon train | band wagon | station wagon | chuck wagon
train wreck | train ing | ship wreck | train station
dark room | dark horse | after dark | dark side
horse back | horse hair | dark horse | race horse | sea horse | work horse | war horse
race track | race car | race horse | arms race | drag race | rat race | horse race
sun dial | dial tone | dial up | ring tone | tone deaf
ring tone | ring leader | ring master | ear ring | key ring | boxing ring | ring side
leader board | cheer leader | ring leader
ear ring | ear ache | ear drum | ear phone | ear shot | ear wax | ear lobe
drum roll | drum stick | ear drum | oil drum | steel drum
roll call | roll over | drum roll | rock and roll | egg roll | log roll | bank roll
call back | call sign | roll call | close call | wake up call | cat call
phone book | phone call | ear phone | head phone | cell phone | pay phone | mega phone
cell phone | cell mate | brain cell | jail cell | prison cell
pay day | pay check | pay phone | pay load | pay roll | pay ment | co pay
day dream | day break | day light | day care | birth day | dooms day | week day
break fast | break water | break dance | jail break | out break | day break | tie break
melon ball | water melon | musk melon
`.trim().split('\n').flatMap(l => l.split('|')).map(s => s.trim().split(/\s+/)).filter(p => p.length === 2);

// build adjacency
const next = new Map();
for (const [a, b] of PAIRS) {
  const A = a.toUpperCase(), B = b.toUpperCase();
  if (!next.has(A)) next.set(A, new Set());
  next.get(A).add(B);
}
const linkSet = new Set(PAIRS.map(([a, b]) => `${a.toUpperCase()} ${b.toUpperCase()}`));

// dictionary of acrostic-legal words
const dict = new Set(
  readFileSync('/usr/share/dict/words', 'utf8').split('\n')
    .map(w => w.trim().toUpperCase()).filter(w => /^[A-Z]{3,5}$/.test(w))
);

// ── enumerate paths ───────────────────────────────────────────────────────
const results = [];
const starts = [...next.keys()];
for (const s of starts) {
  const walk = (path) => {
    if (path.length >= 3 && path.length <= 5) {
      const seed = path.map(w => w[0]).join('');
      // no word repeats within a chain
      if (dict.has(seed) && new Set(path).size === path.length) {
        results.push({ seed, words: [...path] });
      }
    }
    if (path.length === 5) return;
    for (const nx of (next.get(path[path.length - 1]) || [])) {
      if (path.includes(nx)) continue;
      walk([...path, nx]);
    }
  };
  walk([s]);
}

// ── report ────────────────────────────────────────────────────────────────
const byLen = { 3: [], 4: [], 5: [] };
results.forEach(r => byLen[r.seed.length].push(r));
for (const n of [3, 4, 5]) {
  console.log(`\n=========== ${n}-LETTER SEEDS (${byLen[n].length} found) ===========`);
  const seen = new Map();
  byLen[n].forEach(r => { if (!seen.has(r.seed)) seen.set(r.seed, []); seen.get(r.seed).push(r.words); });
  [...seen.entries()].sort().forEach(([seed, list]) => {
    list.slice(0, 4).forEach(w => {
      const links = w.slice(1).map((x, i) => `${w[i].toLowerCase()} ${x.toLowerCase()}`).join(' · ');
      console.log(`${seed.padEnd(6)} ${w.join(' ').padEnd(38)} ${links}`);
    });
  });
}
console.log(`\nTOTAL: ${results.length} chains, ${new Set(results.map(r => r.seed)).size} distinct seeds`);
