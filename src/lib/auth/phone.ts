import { parsePhoneNumberFromString } from "libphonenumber-js/max";

export function normalizeUsPhoneNumber(value: string): string | null {
  const phone = parsePhoneNumberFromString(value.trim(), {
    defaultCountry: "US",
    extract: false,
  });

  if (!phone || phone.country !== "US" || !phone.isValid() || phone.ext) {
    return null;
  }

  return phone.number;
}
