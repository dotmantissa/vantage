import {timingSafeEqual} from 'node:crypto';
export function cronAuthorized(header,secret=process.env.CRON_SECRET){
  if(!secret)return false;
  const actual=Buffer.from(String(header||'')),expected=Buffer.from(`Bearer ${secret}`);
  return actual.length===expected.length&&timingSafeEqual(actual,expected);
}
