/**
 * WickyChat: more ways to earn coins. A free daily spin (plus 🎟️ spin tickets from crates),
 * coins when people react to what you post, Q&A bounties and daily trivia.
 */

/** Daily free spin. `weight` is out of 100. */
export const WHEEL = [
  { coins: 5, weight: 30, color: '#94a3b8' },
  { coins: 10, weight: 25, color: '#60a5fa' },
  { coins: 20, weight: 20, color: '#34d399' },
  { coins: 35, weight: 12, color: '#a78bfa' },
  { coins: 50, weight: 8, color: '#f472b6' },
  { coins: 100, weight: 4, color: '#fb923c' },
  { coins: 250, weight: 1, color: '#facc15' },
] as const

/** Picks a slice from a number in [0, 100). */
export function wheelSlice(roll: number) {
  let r = roll
  for (let i = 0; i < WHEEL.length; i++) {
    r -= WHEEL[i]!.weight
    if (r < 0) return i
  }
  return 0
}

/** Coins for reactions others put on your messages. */
export const LIKES = {
  /** Per person reacting to a message (once per message per person). */
  perReaction: 1,
  dailyCap: 20,
  /** Only fairly recent messages count. */
  maxAgeDays: 7,
}

/** Q&A bounties: put coins on a question; the best reply wins them. */
export const BOUNTY = { min: 5, max: 500 }

export interface Bounty {
  id: string
  messageId: string
  channelId: string
  asker: import('./types').UserSummary
  amount: number
  status: 'open' | 'awarded' | 'cancelled'
  winner: import('./types').UserSummary | null
  answerMessageId: string | null
}

/** Daily trivia: one question for everyone, coins for the right answer. */
export const TRIVIA_REWARD = 15

export interface TriviaQ {
  q: string
  options: string[]
  answer: number
}

const t = (q: string, options: string[], answer: number): TriviaQ => ({ q, options, answer })

export const TRIVIA: TriviaQ[] = [
  t(
    'What is the largest planet in our solar system?',
    ['Saturn', 'Jupiter', 'Neptune', 'Earth'],
    1,
  ),
  t('How many sides does a hexagon have?', ['5', '6', '7', '8'], 1),
  t(
    'What gas do plants take in from the air?',
    ['Oxygen', 'Nitrogen', 'Carbon dioxide', 'Helium'],
    2,
  ),
  t('Which is the longest river in the world?', ['Amazon', 'Yangtze', 'Mississippi', 'Nile'], 3),
  t('What is H₂O?', ['Salt', 'Water', 'Hydrogen', 'Oxygen'], 1),
  t('Who painted the Mona Lisa?', ['Van Gogh', 'Picasso', 'Leonardo da Vinci', 'Monet'], 2),
  t('What is the capital of Korea?', ['Busan', 'Seoul', 'Incheon', 'Daegu'], 1),
  t('How many continents are there?', ['5', '6', '7', '8'], 2),
  t('What is the fastest land animal?', ['Lion', 'Cheetah', 'Horse', 'Greyhound'], 1),
  t('What is 12 × 12?', ['124', '144', '132', '148'], 1),
  t('Which planet is called the Red Planet?', ['Mars', 'Venus', 'Mercury', 'Jupiter'], 0),
  t('What is the hardest natural substance?', ['Gold', 'Iron', 'Diamond', 'Quartz'], 2),
  t('How many bones are in the adult human body?', ['106', '206', '306', '186'], 1),
  t(
    'What language has the most native speakers?',
    ['English', 'Spanish', 'Mandarin Chinese', 'Hindi'],
    2,
  ),
  t(
    'Who wrote "Romeo and Juliet"?',
    ['Charles Dickens', 'William Shakespeare', 'Jane Austen', 'Mark Twain'],
    1,
  ),
  t('What is the boiling point of water at sea level?', ['90°C', '100°C', '110°C', '120°C'], 1),
  t('Which ocean is the largest?', ['Atlantic', 'Indian', 'Arctic', 'Pacific'], 3),
  t('What is the square root of 81?', ['8', '9', '7', '11'], 1),
  t('What do bees make?', ['Milk', 'Silk', 'Honey', 'Wax only'], 2),
  t('Which element has the symbol "O"?', ['Gold', 'Oxygen', 'Osmium', 'Iron'], 1),
  t('What is the smallest prime number?', ['0', '1', '2', '3'], 2),
  t('Which country gave the Statue of Liberty to the USA?', ['UK', 'France', 'Spain', 'Italy'], 1),
  t('How many minutes are in a day?', ['1,440', '1,240', '1,640', '960'], 0),
  t('What is the main language of Brazil?', ['Spanish', 'Portuguese', 'English', 'French'], 1),
  t('What is the freezing point of water in Fahrenheit?', ['0°F', '32°F', '100°F', '-32°F'], 1),
  t('Which organ pumps blood around the body?', ['Lungs', 'Liver', 'Heart', 'Kidneys'], 2),
  t('What is the tallest mountain on Earth?', ['K2', 'Mount Everest', 'Kilimanjaro', 'Denali'], 1),
  t(
    'In computing, what does "CPU" stand for?',
    [
      'Central Processing Unit',
      'Computer Power Unit',
      'Core Program Utility',
      'Central Print Unit',
    ],
    0,
  ),
  t('What is 15% of 200?', ['20', '25', '30', '35'], 2),
  t('Which planet has the most known moons?', ['Earth', 'Mars', 'Saturn', 'Venus'], 2),
  t('What is the chemical symbol for gold?', ['Go', 'Gd', 'Au', 'Ag'], 2),
  t('Who developed the theory of relativity?', ['Newton', 'Einstein', 'Galileo', 'Darwin'], 1),
  t('How many players are on a soccer team on the field?', ['9', '10', '11', '12'], 2),
  t('What is the largest mammal?', ['Elephant', 'Blue whale', 'Giraffe', 'Orca'], 1),
  t('What year did World War II end?', ['1918', '1939', '1945', '1950'], 2),
  t('Which shape has three sides?', ['Square', 'Triangle', 'Pentagon', 'Circle'], 1),
  t('What is the capital of Japan?', ['Osaka', 'Kyoto', 'Tokyo', 'Nagoya'], 2),
  t('What part of the plant makes food using sunlight?', ['Roots', 'Stem', 'Leaves', 'Flowers'], 2),
  t('What is 7³ (7 cubed)?', ['21', '49', '343', '147'], 2),
  t('Which instrument has 88 keys?', ['Guitar', 'Piano', 'Violin', 'Flute'], 1),
  t('What is the closest star to Earth?', ['Sirius', 'Polaris', 'The Sun', 'Alpha Centauri'], 2),
  t(
    'Hangul (the Korean alphabet) was created under which king?',
    ['King Sejong', 'King Taejo', 'King Jeongjo', 'King Gwanggaeto'],
    0,
  ),
  t('How many degrees are in a right angle?', ['45', '90', '180', '360'], 1),
  t(
    'Which gas makes up most of Earth’s air?',
    ['Oxygen', 'Carbon dioxide', 'Nitrogen', 'Argon'],
    2,
  ),
  t('What is the plural of "mouse" (the animal)?', ['Mouses', 'Mice', 'Meese', 'Mouse'], 1),
  t('What is π rounded to two decimal places?', ['3.12', '3.14', '3.16', '3.41'], 1),
  t(
    'Which continent is the Sahara Desert on?',
    ['Asia', 'Africa', 'Australia', 'South America'],
    1,
  ),
  t('What is the binary number 101 in decimal?', ['3', '5', '6', '101'], 1),
  t(
    'Who was the first person to walk on the Moon?',
    ['Buzz Aldrin', 'Yuri Gagarin', 'Neil Armstrong', 'Sally Ride'],
    2,
  ),
  t('What is the main ingredient of guacamole?', ['Tomato', 'Avocado', 'Pepper', 'Onion'], 1),
]

/** Today's question (the same for the whole school, a new one each day). */
export function triviaFor(day: string) {
  let h = 0
  for (const c of day) h = (h * 31 + c.charCodeAt(0)) >>> 0
  const i = h % TRIVIA.length
  return { index: i, ...TRIVIA[i]! }
}

export interface TriviaDay {
  day: string
  question: string
  options: string[]
  /** Set once you've answered. */
  picked: number | null
  answer: number | null
  correct: boolean | null
  /** How many people got it right today. */
  rightToday: number
}

export interface EarnStatus {
  /** Today's free spin is still there. */
  spinAvailable: boolean
  /** Extra spins from crates. */
  spinTickets: number
  likesToday: number
}
