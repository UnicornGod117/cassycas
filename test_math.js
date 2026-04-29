const v = 'x';
const f = '(x^2 - 5*x + a)-(0)';
// Manually mimicking the process
console.log('f:', f);
// f = x^2 - 5x + a
// df/dx = 2x - 5
// d2f/dx2 = 2  => aS = 2
// bS = (2x - 5) - (2)*x = -5
// cS = f(x=0) = a
// disc = (-5)^2 - 2*2*a = 25 - 4a
// r1 = (-(-5) + sqrt(25-4a))/2 = (5 + sqrt(25-4a))/2
