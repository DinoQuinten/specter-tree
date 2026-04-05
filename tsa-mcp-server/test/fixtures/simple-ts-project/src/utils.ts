import { greetAnimal, Dog } from './animals';

export function makeGreeting(): string {
  const dog = new Dog('Rex');
  return greetAnimal(dog);
}

export const VERSION = '1.0.0';
