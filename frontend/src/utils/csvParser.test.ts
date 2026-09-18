import { describe, it, expect } from 'vitest'
import { parseCsv, isValidEmail, formatPhoneNumber, parseYearsInRole, formatLinkedinUrl } from './csvParser'

describe('isValidEmail', () => {
  it('should return true for valid email addresses', () => {
    expect(isValidEmail('test@example.com')).toBe(true)
    expect(isValidEmail('user.name@domain.co.uk')).toBe(true)
    expect(isValidEmail('first.last+tag@example.org')).toBe(true)
    expect(isValidEmail('123@456.com')).toBe(true)
  })

  it('should return false for invalid email addresses', () => {
    expect(isValidEmail('')).toBe(false)
    expect(isValidEmail('invalid')).toBe(false)
    expect(isValidEmail('test@')).toBe(false)
    expect(isValidEmail('@example.com')).toBe(false)
    expect(isValidEmail('test.example.com')).toBe(false)
    expect(isValidEmail('test@.com')).toBe(false)
    expect(isValidEmail('test@example')).toBe(false)
  })
})

describe('parseCsv', () => {
  it('should throw error for empty content', () => {
    expect(() => parseCsv('')).toThrow('CSV content cannot be empty')
    expect(() => parseCsv('   ')).toThrow('CSV content cannot be empty')
  })

  it('should throw error for CSV with only headers', () => {
    const csv = 'firstName,lastName,email'
    expect(() => parseCsv(csv)).toThrow('CSV file appears to be empty or contains no valid data')
  })

  it('should throw error for malformed CSV content', () => {
    const malformedCsv = `firstName,lastName,email
"John,Doe,john@example.com,extra"field`
    expect(() => parseCsv(malformedCsv)).toThrow('CSV parsing failed')
  })

  it('should throw error for CSV with mismatched field count', () => {
    const mismatchedCsv = `firstName,lastName,email
John,Doe,john@example.com,ExtraField,AnotherExtra
Jane,Smith`
    expect(() => parseCsv(mismatchedCsv)).toThrow('CSV parsing failed')
  })

  it('should throw error for CSV with critical delimiter issues', () => {
    const noDelimiterCsv = `firstName lastName email
John Doe john@example.com`
    expect(() => parseCsv(noDelimiterCsv)).toThrow()
  })

  it('should parse valid CSV with all required fields', () => {
    const csv = `firstName,lastName,email,jobTitle,countryCode,companyName
John,Doe,john.doe@example.com,Developer,US,Tech Corp`

    const result = parseCsv(csv)

    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({
      firstName: 'John',
      lastName: 'Doe',
      email: 'john.doe@example.com',
      jobTitle: 'Developer',
      countryCode: 'US',
      companyName: 'Tech Corp',
      isValid: true,
      errors: [],
      warnings: [],
      rowIndex: 2,
    })
  })

  it('should handle missing required fields and mark as invalid', () => {
    const csv = `firstName,lastName,email
,Smith,john@example.com
John,,john@example.com
John,Smith,`

    const result = parseCsv(csv)

    expect(result).toHaveLength(3)

    expect(result[0].isValid).toBe(false)
    expect(result[0].errors).toContain('First name is required')

    expect(result[1].isValid).toBe(false)
    expect(result[1].errors).toContain('Last name is required')

    expect(result[2].isValid).toBe(false)
    expect(result[2].errors).toContain('Email is required')
  })

  it('should validate email format', () => {
    const csv = `firstName,lastName,email
John,Doe,invalid-email
Jane,Smith,jane@example.com`

    const result = parseCsv(csv)

    expect(result).toHaveLength(2)
    expect(result[0].isValid).toBe(false)
    expect(result[0].errors).toContain('Invalid email format')
    expect(result[1].isValid).toBe(true)
  })

  it('should handle CSV with quoted values', () => {
    const csv = `firstName,lastName,email,jobTitle
"John","Doe","john.doe@example.com","Software Engineer"`

    const result = parseCsv(csv)

    expect(result).toHaveLength(1)
    expect(result[0].firstName).toBe('John')
    expect(result[0].lastName).toBe('Doe')
    expect(result[0].email).toBe('john.doe@example.com')
    expect(result[0].jobTitle).toBe('Software Engineer')
  })

  it('should skip empty rows', () => {
    const csv = `firstName,lastName,email
John,Doe,john@example.com
,,
Jane,Smith,jane@example.com`

    const result = parseCsv(csv)

    expect(result).toHaveLength(2)
    expect(result[0].firstName).toBe('John')
    expect(result[1].firstName).toBe('Jane')
  })

  it('should handle case-insensitive headers', () => {
    const csv = `FIRSTNAME,LASTNAME,EMAIL,JOBTITLE,COUNTRYCODE,COMPANYNAME
John,Doe,john@example.com,Developer,US,Tech Corp`

    const result = parseCsv(csv)

    expect(result).toHaveLength(1)
    expect(result[0].firstName).toBe('John')
    expect(result[0].lastName).toBe('Doe')
    expect(result[0].email).toBe('john@example.com')
    expect(result[0].jobTitle).toBe('Developer')
  })

  it('should handle missing optional fields', () => {
    const csv = `firstName,lastName,email,jobTitle,countryCode
John,Doe,john@example.com,,`

    const result = parseCsv(csv)

    expect(result).toHaveLength(1)
    expect(result[0].jobTitle).toBeUndefined()
    expect(result[0].countryCode).toBeUndefined()
    expect(result[0].isValid).toBe(true)
  })

  it('should preserve row index correctly', () => {
    const csv = `firstName,lastName,email
John,Doe,john@example.com
Jane,Smith,jane@example.com
Bob,Johnson,bob@example.com`

    const result = parseCsv(csv)

    expect(result).toHaveLength(3)
    expect(result[0].rowIndex).toBe(2)
    expect(result[1].rowIndex).toBe(3)
    expect(result[2].rowIndex).toBe(4)
  })

  it('should handle multiple validation errors per lead', () => {
    const csv = `firstName,lastName,email
 , ,invalid-email`

    const result = parseCsv(csv)

    expect(result).toHaveLength(1)
    expect(result[0].isValid).toBe(false)
    expect(result[0].errors).toHaveLength(3)
    expect(result[0].errors).toContain('First name is required')
    expect(result[0].errors).toContain('Last name is required')
    expect(result[0].errors).toContain('Invalid email format')
  })

  it('should handle extra columns not in header mapping', () => {
    const csv = `firstName,lastName,email,unknownColumn
John,Doe,john@example.com,someValue`

    const result = parseCsv(csv)

    expect(result).toHaveLength(1)
    expect(result[0].firstName).toBe('John')
    expect(result[0].lastName).toBe('Doe')
    expect(result[0].email).toBe('john@example.com')
    expect(result[0].isValid).toBe(true)
  })

  it('should handle mixed valid and invalid leads', () => {
    const csv = `firstName,lastName,email
John,Doe,john@example.com
,Smith,invalid-email
Jane,Johnson,jane@example.com`

    const result = parseCsv(csv)

    expect(result).toHaveLength(3)
    expect(result[0].isValid).toBe(true)
    expect(result[1].isValid).toBe(false)
    expect(result[1].errors).toContain('First name is required')
    expect(result[1].errors).toContain('Invalid email format')
    expect(result[2].isValid).toBe(true)
  })

  it('should handle whitespace in fields', () => {
    const csv = `firstName,lastName,email
 John , Doe , john@example.com `

    const result = parseCsv(csv)

    expect(result).toHaveLength(1)
    expect(result[0].firstName).toBe('John')
    expect(result[0].lastName).toBe('Doe')
    expect(result[0].email).toBe('john@example.com')
    expect(result[0].isValid).toBe(true)
  })
})

describe('formatPhoneNumber', () => {
  it('should return nothing for empty values', () => {
    expect(formatPhoneNumber('')).toEqual({})
    expect(formatPhoneNumber('   ')).toEqual({})
  })

  it('should strip separators from national numbers', () => {
    expect(formatPhoneNumber('(731)123-9702').value).toBe('7311239702')
    expect(formatPhoneNumber('823-978-4724').value).toBe('8239784724')
    expect(formatPhoneNumber('063.430.8860').value).toBe('0634308860')
  })

  it('should keep the leading plus on international numbers', () => {
    expect(formatPhoneNumber('+1-280-754-0462').value).toBe('+12807540462')
    expect(formatPhoneNumber('+34 600 123 456').value).toBe('+34600123456')
  })

  it('should normalize the 00 international prefix to +', () => {
    expect(formatPhoneNumber('001-464-312-8555').value).toBe('+14643128555')
  })

  it('should preserve extensions', () => {
    expect(formatPhoneNumber('+1-280-754-0462x2154').value).toBe('+12807540462 ext. 2154')
    expect(formatPhoneNumber('063.430.8860x4762').value).toBe('0634308860 ext. 4762')
    expect(formatPhoneNumber('414-902-6626 ext. 468').value).toBe('4149026626 ext. 468')
  })

  it('should warn and drop values that are not phone numbers', () => {
    expect(formatPhoneNumber('n/a').value).toBeUndefined()
    expect(formatPhoneNumber('n/a').warning).toContain('not a valid phone number')
    expect(formatPhoneNumber('12345').warning).toContain('not a valid phone number')
    expect(formatPhoneNumber('1234567890123456789').warning).toContain('not a valid phone number')
  })
})

describe('parseYearsInRole', () => {
  it('should return nothing for empty values', () => {
    expect(parseYearsInRole('')).toEqual({})
    expect(parseYearsInRole('   ')).toEqual({})
  })

  it('should parse whole numbers', () => {
    expect(parseYearsInRole('5').value).toBe(5)
    expect(parseYearsInRole('0').value).toBe(0)
    expect(parseYearsInRole('15').value).toBe(15)
  })

  it('should parse numbers written with a unit or a plus sign', () => {
    expect(parseYearsInRole('5 years').value).toBe(5)
    expect(parseYearsInRole('3 yrs').value).toBe(3)
    expect(parseYearsInRole('10+').value).toBe(10)
  })

  it('should truncate fractional years', () => {
    expect(parseYearsInRole('2.5').value).toBe(2)
    expect(parseYearsInRole('2,5 years').value).toBe(2)
  })

  it('should warn and drop values that are not numbers', () => {
    expect(parseYearsInRole('since 2019').value).toBeUndefined()
    expect(parseYearsInRole('since 2019').warning).toContain('not a whole number')
    expect(parseYearsInRole('-3').warning).toContain('not a whole number')
  })

  it('should warn and drop values outside the plausible range', () => {
    expect(parseYearsInRole('120').value).toBeUndefined()
    expect(parseYearsInRole('120').warning).toContain('out of range')
  })
})

describe('formatLinkedinUrl', () => {
  it('should return nothing for empty values', () => {
    expect(formatLinkedinUrl('')).toEqual({})
    expect(formatLinkedinUrl('   ')).toEqual({})
  })

  it('should keep canonical profile URLs unchanged', () => {
    expect(formatLinkedinUrl('https://www.linkedin.com/in/john-doe').value).toBe(
      'https://www.linkedin.com/in/john-doe'
    )
  })

  it('should add the missing scheme and www host', () => {
    expect(formatLinkedinUrl('linkedin.com/in/john-doe').value).toBe('https://www.linkedin.com/in/john-doe')
    expect(formatLinkedinUrl('www.linkedin.com/in/john-doe').value).toBe(
      'https://www.linkedin.com/in/john-doe'
    )
  })

  it('should normalize country subdomains, trailing slashes, query strings and casing', () => {
    expect(formatLinkedinUrl('https://es.linkedin.com/in/John-Doe?trk=public_profile').value).toBe(
      'https://www.linkedin.com/in/john-doe'
    )
    expect(formatLinkedinUrl('http://www.linkedin.com/in/john-doe/#about').value).toBe(
      'https://www.linkedin.com/in/john-doe'
    )
  })

  it('should build a profile URL from a bare handle', () => {
    expect(formatLinkedinUrl('john-doe').value).toBe('https://www.linkedin.com/in/john-doe')
  })

  it('should warn and drop anything that is not a personal profile', () => {
    expect(formatLinkedinUrl('https://www.linkedin.com/company/acme').value).toBeUndefined()
    expect(formatLinkedinUrl('https://www.linkedin.com/company/acme').warning).toContain(
      'not a LinkedIn profile URL'
    )
    expect(formatLinkedinUrl('https://twitter.com/john-doe').warning).toContain('not a LinkedIn profile URL')
    expect(formatLinkedinUrl('not a profile').warning).toContain('not a LinkedIn profile URL')
  })
})

describe('parseCsv', () => {
  it('should parse and format phoneNumber, yearsInRole and linkedinUrl', () => {
    const csv = `firstName,lastName,email,yearsInRole,phoneNumber,linkedinUrl
John,Doe,john@example.com,5,+1-280-754-0462x2154,linkedin.com/in/john-doe`

    const result = parseCsv(csv)

    expect(result[0].phoneNumber).toBe('+12807540462 ext. 2154')
    expect(result[0].yearsInRole).toBe(5)
    expect(result[0].linkedinUrl).toBe('https://www.linkedin.com/in/john-doe')
    expect(result[0].warnings).toEqual([])
    expect(result[0].isValid).toBe(true)
  })

  it('should accept alternative header spellings for the new fields', () => {
    const csv = `firstName,lastName,email,Years at Company,Phone,LinkedIn Profile
John,Doe,john@example.com,3,823-978-4724,https://www.linkedin.com/in/john-doe`

    const result = parseCsv(csv)

    expect(result[0].yearsInRole).toBe(3)
    expect(result[0].phoneNumber).toBe('8239784724')
    expect(result[0].linkedinUrl).toBe('https://www.linkedin.com/in/john-doe')
  })

  it('should leave the new fields undefined when the columns are empty', () => {
    const csv = `firstName,lastName,email,yearsInRole,phoneNumber,linkedinUrl
John,Doe,john@example.com,,,`

    const result = parseCsv(csv)

    expect(result[0].phoneNumber).toBeUndefined()
    expect(result[0].yearsInRole).toBeUndefined()
    expect(result[0].linkedinUrl).toBeUndefined()
    expect(result[0].warnings).toEqual([])
  })

  it('should skip a row of nothing but delimiters instead of failing the file', () => {
    const csv = `firstName,lastName,email,yearsInRole,phoneNumber,linkedinUrl
John,Doe,john@example.com,5,823-978-4724,linkedin.com/in/john-doe
,,,,,
Jane,Smith,jane@example.com,2,,`

    const result = parseCsv(csv)

    expect(result).toHaveLength(2)
    expect(result[0].firstName).toBe('John')
    expect(result[1].firstName).toBe('Jane')
  })

  it('should skip a delimiter-only row that is short a column', () => {
    const csv = `firstName,lastName,email,yearsInRole,phoneNumber,linkedinUrl
John,Doe,john@example.com,5,823-978-4724,linkedin.com/in/john-doe
,,,,`

    const result = parseCsv(csv)

    expect(result).toHaveLength(1)
    expect(result[0].firstName).toBe('John')
  })

  it('should warn without invalidating the row when a new field cannot be formatted', () => {
    const csv = `firstName,lastName,email,yearsInRole,phoneNumber,linkedinUrl
John,Doe,john@example.com,since 2019,n/a,https://twitter.com/john-doe`

    const result = parseCsv(csv)

    expect(result[0].isValid).toBe(true)
    expect(result[0].errors).toEqual([])
    expect(result[0].warnings).toHaveLength(3)
    expect(result[0].phoneNumber).toBeUndefined()
    expect(result[0].yearsInRole).toBeUndefined()
    expect(result[0].linkedinUrl).toBeUndefined()
  })
})
