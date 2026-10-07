/**
 * The questions a launch is stress-tested against.
 *
 * A launcher does not think in "three snipers and six organic buyers". They
 * think "what happens if a bot is first" and "does this still graduate if
 * nobody unusual turns up". Each scenario below is one of those questions,
 * expressed as a crowd the existing archetypes can actually produce — no
 * scenario asks for a behaviour that is not already implemented.
 */

export type ScenarioKey = 'organic' | 'sniper' | 'whale' | 'sell-pressure' | 'adversarial'

export interface Scenario {
  readonly key: ScenarioKey
  readonly label: string
  /** The question this scenario exists to answer. */
  readonly asks: string
  /** What the crowd does, in the words of the archetypes that implement it. */
  readonly behaviour: string
  readonly snipers: number
  readonly whales: number
  readonly organics: number
  /** Chance an organic holder sells a slice rather than buying more. */
  readonly sellChance: number
  /** Chance an organic buyer acts at all in a given round. */
  readonly activity: number
}

export const SCENARIOS: readonly Scenario[] = [
  {
    key: 'organic',
    label: 'Organic',
    asks: 'Does this curve graduate on ordinary flow alone?',
    behaviour: 'Small, frequent buys spread over time, with occasional partial sells.',
    snipers: 0,
    whales: 0,
    organics: 14,
    sellChance: 0.2,
    activity: 0.5,
  },
  {
    key: 'sniper',
    label: 'Sniper',
    asks: 'Can a bot take the float in the first seconds and exit into everyone else?',
    behaviour:
      'Four bots each buy a sixth of the raise before anyone else and sell the whole position ' +
      'the moment it is worth 1.6× what it cost — but only while the fee is at or under 3%. ' +
      'Above that they wait for the schedule to bring it down, or never come.',
    snipers: 4,
    whales: 0,
    organics: 10,
    sellChance: 0.2,
    activity: 0.45,
  },
  {
    key: 'whale',
    label: 'Whale',
    asks: 'What does a buyer large enough to move the price alone do to everyone after them?',
    behaviour:
      'Three buyers, each arriving with three times the raise and spending a quarter of it at a ' +
      'time, 20 to 90 seconds apart. A whale never sells.',
    snipers: 0,
    whales: 3,
    organics: 8,
    sellChance: 0.2,
    activity: 0.4,
  },
  {
    key: 'sell-pressure',
    label: 'Sell pressure',
    asks: 'Does the raise stall when early buyers keep taking profit?',
    behaviour:
      'Organic holders sell three times in four, 10–60% of the position at a time. ' +
      'Steady profit taking rather than a panic — the archetype has no panic.',
    snipers: 1,
    whales: 0,
    organics: 16,
    sellChance: 0.75,
    activity: 0.55,
  },
  {
    key: 'adversarial',
    label: 'Mixed adversarial',
    asks: 'All of it at once — is the curve still standing?',
    behaviour: 'Snipers in first, whales through the middle, and organic flow selling into both.',
    snipers: 3,
    whales: 2,
    organics: 12,
    sellChance: 0.5,
    activity: 0.5,
  },
]

export const scenarioFor = (key: ScenarioKey): Scenario =>
  SCENARIOS.find((scenario) => scenario.key === key) ?? SCENARIOS[0]!
