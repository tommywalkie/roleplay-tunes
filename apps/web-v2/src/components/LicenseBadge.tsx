import { licenseMark, LicenseGlyphs } from './licenseMarks';
import { Popover } from './Popover';
import { Icon } from './ui';
import { licenseText } from '../editors/LicenseField';
import { useI18n } from '../i18n';

/**
 * The license of an item, as its mark rather than its name: a row has to fit a lot of
 * things, and "CC BY-NC-ND 4.0" spelled out is wider than the sound it describes. The full
 * wording is one hover, one focus or one tap away in a `Popover`, and it is also what the
 * mark says to a screen reader, so nothing is lost to the abbreviation.
 *
 * Creative Commons licenses carry a suite of marks — the Commons mark plus the elements
 * that qualify it — exactly as CC publishes them.
 */
export function LicenseBadge({ value }: { value: string }) {
  const { t } = useI18n();
  const text = licenseText(value, t);
  const label = t('library.license', { license: text });
  const mark = licenseMark(value);

  return (
    <Popover label={label} note={text}>
      {'marks' in mark ? (
        <span className="flex shrink-0 items-center gap-0.5">
          <LicenseGlyphs marks={mark.marks} className="size-[18px] shrink-0" />
        </span>
      ) : (
        <Icon icon={mark.icon} className="size-[18px]" />
      )}
    </Popover>
  );
}
