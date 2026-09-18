import Papa from 'papaparse'

export interface CsvLead {
  firstName: string
  lastName: string
  email: string
  jobTitle?: string
  countryCode?: string
  companyName?: string
  phoneNumber?: string
  yearsInRole?: number
  linkedinUrl?: string
  isValid: boolean
  errors: string[]
  warnings: string[]
  rowIndex: number
}

/**
 * Result of formatting an optional field: either a normalized `value`, or a `warning`
 * explaining why the raw value was dropped. Both are absent when the cell was empty.
 * Warnings never invalidate a row - only the required fields do that.
 */
export interface FormattedField<T> {
  value?: T
  warning?: string
}

export const isValidEmail = (email: string): boolean => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return emailRegex.test(email)
}

// Trailing extension, e.g. "x2154", "ext. 33", "#12"
const PHONE_EXTENSION_REGEX = /(?:ext|extension|x|#)\s*\.?\s*(\d{1,6})\s*$/i
const MIN_PHONE_DIGITS = 7
const MAX_PHONE_DIGITS = 15

/**
 * Normalizes the many shapes phone numbers arrive in - "(731)123-9702",
 * "063.430.8860x4762", "001-464-312-8555" - into a compact digit string, keeping any
 * extension. A leading "+" or the international access prefix "00" both become "+".
 */
export const formatPhoneNumber = (rawValue: string): FormattedField<string> => {
  const raw = rawValue.trim()
  if (!raw) return {}

  const extensionMatch = raw.match(PHONE_EXTENSION_REGEX)
  const extension = extensionMatch?.[1]
  const base = extensionMatch ? raw.slice(0, extensionMatch.index) : raw

  let digits = base.replace(/\D/g, '')
  const isInternational = base.trimStart().startsWith('+') || digits.startsWith('00')
  if (digits.startsWith('00')) digits = digits.slice(2)

  if (digits.length < MIN_PHONE_DIGITS || digits.length > MAX_PHONE_DIGITS) {
    return { warning: `Phone number "${raw}" is not a valid phone number and was skipped` }
  }

  const formatted = isInternational ? `+${digits}` : digits
  return { value: extension ? `${formatted} ext. ${extension}` : formatted }
}

// "5", "5 years", "10+", "2.5 yrs" - the leading number is what matters
const YEARS_IN_ROLE_REGEX = /^(\d{1,3})(?:[.,]\d+)?\+?\s*(?:years?|yrs?|y)?\.?$/i
const MAX_YEARS_IN_ROLE = 70

/**
 * Parses years in the current role into a whole number. Fractional values are
 * truncated ("2.5 yrs" -> 2) because the column is stored as an integer.
 */
export const parseYearsInRole = (rawValue: string): FormattedField<number> => {
  const raw = rawValue.trim()
  if (!raw) return {}

  const match = raw.match(YEARS_IN_ROLE_REGEX)
  if (!match) {
    return { warning: `Years in role "${raw}" is not a whole number and was skipped` }
  }

  const years = Number(match[1])
  if (years > MAX_YEARS_IN_ROLE) {
    return { warning: `Years in role "${raw}" is out of range (0-${MAX_YEARS_IN_ROLE}) and was skipped` }
  }

  return { value: years }
}

const URL_SCHEME_REGEX = /^[a-z][a-z0-9+.-]*:\/\//i
const LINKEDIN_HOST_REGEX = /(^|\.)linkedin\.com$/i
const LINKEDIN_SLUG_REGEX = /^[\p{L}\p{N}\-_]{3,100}$/u

/**
 * Normalizes a LinkedIn profile to `https://www.linkedin.com/in/<slug>`. Accepts full
 * URLs with or without a scheme, country subdomains, tracking query strings, and bare
 * handles ("john-doe"). Anything that is not a personal profile (company pages, other
 * hosts) is dropped with a warning.
 */
export const formatLinkedinUrl = (rawValue: string): FormattedField<string> => {
  const raw = rawValue.trim()
  if (!raw) return {}

  const skipped = { warning: `LinkedIn URL "${raw}" is not a LinkedIn profile URL and was skipped` }

  const hasScheme = URL_SCHEME_REGEX.test(raw)
  if (!hasScheme && !raw.includes('/') && !raw.includes('.')) {
    // A bare handle such as "john-doe"
    return LINKEDIN_SLUG_REGEX.test(raw)
      ? { value: `https://www.linkedin.com/in/${raw.toLowerCase()}` }
      : skipped
  }

  let url: URL
  try {
    url = new URL(hasScheme ? raw : `https://${raw}`)
  } catch {
    return skipped
  }

  if (!LINKEDIN_HOST_REGEX.test(url.hostname)) return skipped

  const segments = url.pathname.split('/').filter(Boolean)
  if (segments.length < 2 || segments[0].toLowerCase() !== 'in') return skipped

  let slug: string
  try {
    slug = decodeURIComponent(segments[1])
  } catch {
    return skipped
  }

  if (!LINKEDIN_SLUG_REGEX.test(slug)) return skipped

  return { value: `https://www.linkedin.com/in/${slug.toLowerCase()}` }
}

const isEmptyRow = (row?: Record<string, string>): boolean =>
  !row || Object.values(row).every((value) => !value)

export const parseCsv = (content: string): CsvLead[] => {
  if (!content?.trim()) {
    throw new Error('CSV content cannot be empty')
  }

  const parseResult = Papa.parse<Record<string, string>>(content, {
    header: true,
    skipEmptyLines: true,
    transform: (value) => value.trim(),
    transformHeader: (header) => header.trim().toLowerCase(),
    quoteChar: '"',
  })

  if (parseResult.errors.length > 0) {
    const criticalErrors = parseResult.errors.filter((error) => {
      // A row of nothing but delimiters (",,,,") is reported as a field mismatch. It carries no
      // data and is skipped below, so it must not fail the whole file.
      if (
        error.type === 'FieldMismatch' &&
        error.row !== undefined &&
        isEmptyRow(parseResult.data[error.row])
      ) {
        return false
      }
      return error.type === 'Delimiter' || error.type === 'Quotes' || error.type === 'FieldMismatch'
    })
    if (criticalErrors.length > 0) {
      throw new Error(`CSV parsing failed: ${criticalErrors[0].message}`)
    }
  }

  if (!parseResult.data || parseResult.data.length === 0) {
    throw new Error('CSV file appears to be empty or contains no valid data')
  }

  const data: CsvLead[] = []

  parseResult.data.forEach((row, index) => {
    if (isEmptyRow(row)) return

    const lead: Partial<CsvLead> = { rowIndex: index + 2 }
    let rawPhoneNumber = ''
    let rawYearsInRole = ''
    let rawLinkedinUrl = ''

    Object.entries(row).forEach(([header, value]) => {
      const normalizedHeader = header.toLowerCase().replace(/[^a-z]/g, '')
      const trimmedValue = value?.trim() || ''

      switch (normalizedHeader) {
        case 'firstname':
          lead.firstName = trimmedValue
          break
        case 'lastname':
          lead.lastName = trimmedValue
          break
        case 'email':
          lead.email = trimmedValue
          break
        case 'jobtitle':
          lead.jobTitle = trimmedValue || undefined
          break
        case 'countrycode':
          lead.countryCode = trimmedValue || undefined
          break
        case 'companyname':
          lead.companyName = trimmedValue || undefined
          break
        case 'phonenumber':
        case 'phone':
        case 'telephone':
        case 'mobile':
          rawPhoneNumber = trimmedValue
          break
        case 'yearsinrole':
        case 'yearsatcompany':
        case 'yearsincompany':
        case 'years':
          rawYearsInRole = trimmedValue
          break
        case 'linkedinurl':
        case 'linkedin':
        case 'linkedinprofile':
        case 'linkedinprofileurl':
          rawLinkedinUrl = trimmedValue
          break
      }
    })

    const warnings: string[] = []
    const phoneNumber = formatPhoneNumber(rawPhoneNumber)
    const yearsInRole = parseYearsInRole(rawYearsInRole)
    const linkedinUrl = formatLinkedinUrl(rawLinkedinUrl)

    for (const { warning } of [phoneNumber, yearsInRole, linkedinUrl]) {
      if (warning) warnings.push(warning)
    }

    lead.phoneNumber = phoneNumber.value
    lead.yearsInRole = yearsInRole.value
    lead.linkedinUrl = linkedinUrl.value

    const errors: string[] = []
    if (!lead.firstName?.trim()) {
      errors.push('First name is required')
    }
    if (!lead.lastName?.trim()) {
      errors.push('Last name is required')
    }
    if (!lead.email?.trim()) {
      errors.push('Email is required')
    } else if (!isValidEmail(lead.email)) {
      errors.push('Invalid email format')
    }

    data.push({
      ...lead,
      firstName: lead.firstName || '',
      lastName: lead.lastName || '',
      email: lead.email || '',
      isValid: errors.length === 0,
      errors,
      warnings,
    } as CsvLead)
  })

  return data
}
