/**
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

/**
 * Interpolates `{FilterName}` placeholders in a chart title template with
 * the current active filter values.
 *
 * @param titleTemplate - The chart title string, potentially containing
 *   `{FilterName}` placeholders matching native filter names.
 * @param filterValues - A map of filter name (case-insensitive key) to its
 *   current label/value, or `null` if the filter has no active selection.
 * @returns The resolved title string. If a placeholder has a value, it is
 *   replaced with that value. If a placeholder has no value (`null`), it
 *   becomes `[FilterName]` to visually indicate the unset state. Unknown
 *   placeholders that don't match any filter name are left unchanged.
 *
 * @example
 * interpolateDynamicTitle('Sales in {Country}', { country: 'Kenya' })
 * // => 'Sales in Kenya'
 *
 * interpolateDynamicTitle('Sales in {Country}', { country: null })
 * // => 'Sales in [Country]'
 *
 * interpolateDynamicTitle('Total Revenue', {})
 * // => 'Total Revenue'
 */
export function interpolateDynamicTitle(
  titleTemplate: string,
  filterValues: Record<string, string | null>,
): string {
  // Fast path: if the template has no curly-brace placeholders, return as-is.
  if (!titleTemplate.includes('{')) {
    return titleTemplate;
  }

  // Build a lower-cased lookup for case-insensitive matching.
  const lowerCaseMap: Record<string, string | null> = {};
  Object.entries(filterValues).forEach(([key, value]) => {
    lowerCaseMap[key.toLowerCase()] = value;
  });

  return titleTemplate.replace(/\{([^}]+)\}/g, (match, placeholder: string) => {
    const lowerPlaceholder = placeholder.toLowerCase();
    if (Object.prototype.hasOwnProperty.call(lowerCaseMap, lowerPlaceholder)) {
      const value = lowerCaseMap[lowerPlaceholder];
      // Use the bracket notation as a visual cue that the filter is unset.
      return value !== null && value !== undefined && value !== ''
        ? value
        : `[${placeholder}]`;
    }
    // Unknown placeholder — leave unchanged.
    return match;
  });
}
