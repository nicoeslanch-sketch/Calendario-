export const PERSON = Object.freeze({
  nicolas: 'Nicolás',
  benjamin: 'Benjamín',
  tomas: 'Tomás',
  ambos: 'Compartido',
});

export const PERSON_COLOR = Object.freeze({
  nicolas: '#3e6b8c',
  benjamin: '#a94f86',
  tomas: '#b56a16',
  ambos: '#2f8659',
});

export function isValidPerson(person) {
  return Object.hasOwn(PERSON, person);
}

export function isVisibleForPerson(selectedPerson, responsible) {
  return selectedPerson === 'ambos'
    || responsible === selectedPerson
    || responsible === 'ambos';
}
