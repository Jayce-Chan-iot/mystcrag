import { TAROT_CARD_CATALOG, tarotCardById } from "./card-catalog";
import { requiredSlotsForSpread } from "./spreads";
import type {
  PrivateDrawState,
  RandomSource,
  RevealedTarotCard,
  TarotOrientation,
  TarotSlot,
  TarotSpreadType,
} from "./types";

const checkedRandomInt = (random: RandomSource, maxExclusive: number): number => {
  const value = random.nextInt(maxExclusive);
  if (!Number.isInteger(value) || value < 0 || value >= maxExclusive) {
    throw new Error("RandomSource returned a value outside its requested range");
  }
  return value;
};

const immutableState = (state: PrivateDrawState): PrivateDrawState =>
  Object.freeze({
    ...state,
    deckOrder: Object.freeze([...state.deckOrder]),
    orientationOrder: Object.freeze([...state.orientationOrder]),
    selections: Object.freeze(state.selections.map((selection) => Object.freeze({ ...selection }))),
  });

const toRevealedCards = (state: PrivateDrawState): readonly RevealedTarotCard[] =>
  Object.freeze(state.selections.map((selection) => {
    const cardId = state.deckOrder[selection.displayedPosition];
    const card = cardId ? tarotCardById(cardId) : undefined;
    const orientation = state.orientationOrder[selection.displayedPosition];
    if (!card || !orientation) {
      throw new Error("private draw state references an unavailable card");
    }
    return Object.freeze({
      ...card,
      slot: selection.slot,
      orientation,
      displayedPosition: selection.displayedPosition,
    });
  }));

export function createPrivateDrawState(input: {
  spreadType: TarotSpreadType;
  random: RandomSource;
}): PrivateDrawState {
  const deckOrder = TAROT_CARD_CATALOG.map((card) => card.id);
  for (let index = deckOrder.length - 1; index > 0; index -= 1) {
    const selectedIndex = checkedRandomInt(input.random, index + 1);
    const selectedCard = deckOrder[selectedIndex];
    deckOrder[selectedIndex] = deckOrder[index]!;
    deckOrder[index] = selectedCard!;
  }

  const orientationOrder: TarotOrientation[] = deckOrder.map(() =>
    checkedRandomInt(input.random, 2) === 0 ? "UPRIGHT" : "REVERSED",
  );

  return immutableState({
    spreadType: input.spreadType,
    deckOrder,
    orientationOrder,
    selections: [],
    revision: 0,
    revealed: false,
  });
}

export function selectPosition(
  state: PrivateDrawState,
  command: {
    slot: TarotSlot;
    displayedPosition: number;
    expectedRevision: number;
    operationId: string;
  },
): PrivateDrawState {
  const previousSelection = state.selections.find(
    (selection) => selection.operationId === command.operationId,
  );
  if (previousSelection) {
    if (
      previousSelection.slot !== command.slot ||
      previousSelection.displayedPosition !== command.displayedPosition
    ) {
      throw new Error("operationId was already used for a different selection");
    }
    return state;
  }

  if (state.revealed) {
    throw new Error("draw is already revealed");
  }

  if (command.expectedRevision !== state.revision) {
    throw new Error("stale revision");
  }
  if (
    !Number.isInteger(command.displayedPosition) ||
    command.displayedPosition < 0 ||
    command.displayedPosition >= state.deckOrder.length
  ) {
    throw new Error("displayed position must be within the deck");
  }

  const expectedSlot = requiredSlotsForSpread(state.spreadType)[state.selections.length];
  if (command.slot !== expectedSlot) {
    throw new Error(`expected slot ${expectedSlot}`);
  }
  if (state.selections.some((selection) => selection.displayedPosition === command.displayedPosition)) {
    throw new Error("displayed position already selected");
  }

  return immutableState({
    ...state,
    selections: [...state.selections, {
      slot: command.slot,
      displayedPosition: command.displayedPosition,
      operationId: command.operationId,
    }],
    revision: state.revision + 1,
  });
}

export function revealDraw(
  state: PrivateDrawState,
  expectedRevision: number,
): { state: PrivateDrawState; cards: readonly RevealedTarotCard[] } {
  if (expectedRevision !== state.revision) {
    throw new Error("stale revision");
  }
  if (state.selections.length !== requiredSlotsForSpread(state.spreadType).length) {
    throw new Error("draw is incomplete");
  }

  const cards = toRevealedCards(state);
  if (state.revealed) {
    return { state, cards };
  }

  return {
    state: immutableState({ ...state, revealed: true, revision: state.revision + 1 }),
    cards,
  };
}
