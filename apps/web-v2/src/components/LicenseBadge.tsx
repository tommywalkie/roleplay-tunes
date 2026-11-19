import { licenseMark, LicenseGlyphs } from './licenseMarks';
import { Popover } from './Popover';
import { Icon, cx } from './ui';
import { licenseHint, licenseText } from '../editors/LicenseField';
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
export function LicenseBadge({
  value,
  /** Box of each mark; a tile's 16px meta line wants less than a row's 18px. */
  size = 'size-[18px]',
}: {
  value: string;
  size?: string;
}) {
  const { t } = useI18n();
  const text = licenseText(value, t);
  const label = t('library.license', { license: text });
  const mark = licenseMark(value);
  // A license nobody recorded shows no mark, and no popover to open.
  if ('none' in mark) return null;

  // Like the sound tile's play-mode note: the name, then what its terms mean.
  const hintKey = licenseHint(value);

  return (
    <Popover
      label={label}
      note={
        hintKey ? (
          <>
            <span className="block font-medium text-ink">{text}</span>
            {t(hintKey)}
          </>
        ) : (
          text
        )
      }
    >
      {'marks' in mark ? (
        <span className="flex shrink-0 items-center gap-0.5">
          <LicenseGlyphs marks={mark.marks} className={cx(size, 'shrink-0')} />
        </span>
      ) : (
        <Icon icon={mark.icon} className={size} />
      )}
    </Popover>
  );
}
