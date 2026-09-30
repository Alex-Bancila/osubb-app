/** "1 grup ales", "3 grupuri alese", "20 de grupuri alese". */
export function chosenGroupsLabel(count: number) {
  if (count === 1) return '1 grup ales';
  const small = count % 100 > 0 && count % 100 < 20;
  return `${count} ${small ? '' : 'de '}grupuri alese`;
}
