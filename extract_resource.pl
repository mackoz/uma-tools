use strict;
use warnings;
use v5.28;
use utf8;

use Cwd 'abs_path';
use File::Basename;
use File::Copy;
use File::Path qw(make_path);
use DBI;
use DBD::SQLite::Constants qw(:file_open);

if (!@ARGV) {
	die 'Usage: extract_resource.pl meta <query>';
}

# Derives the per-server suffix (e.g. "_jp") from a meta/meta.decrypted filename, so the
# dat/ lookup below follows whichever server's meta was passed in -- JP-specific files are
# suffixed (meta_jp, dat_jp/), Global stays unsuffixed (meta, dat/). Twin implementations:
# make_uma_info.pl (Perl) and scripts/download-game-assets.mjs (JS) -- keep the regex
# identical in all three if it ever changes. See docs/master-mdb-schema.md.
#
# Dies rather than guessing on an unrecognized name (e.g. a leftover pre-convention
# "meta-jp") -- silently falling back to the unsuffixed (Global) dat/ would misroute
# extraction into the wrong server's cache with nothing louder than a warning (PIPE-17
# review, 2026-08-28).
sub server_suffix {
	my ($basename) = @_;
	if ($basename =~ /^(?:master|meta)(_[A-Za-z0-9]+)?(?:\.mdb|\.decrypted)?$/) {
		return $1 // '';
	}
	die "extract_resource.pl: couldn't derive a server suffix from '$basename' -- rename it to the master_jp.mdb/meta_jp convention (see docs/master-mdb-schema.md) rather than guessing which server's dat/ to use";
}

my $meta = shift @ARGV;
my $root = dirname(abs_path($meta));
my $datadir = $root . "/dat" . server_suffix(basename($meta));

my $query = shift @ARGV;

my $metadb = DBI->connect("dbi:SQLite:$meta", undef, undef, {
	sqlite_open_flags => SQLITE_OPEN_READONLY
});
$metadb->{RaiseError} = 1;

# work around windows quoting issues (just use ^ as a quote instead)
$query =~ s/\^/"/g;

say "SELECT h, e FROM a WHERE n LIKE \"$query\";";

my $select = $metadb->prepare("SELECT h, e FROM a WHERE n LIKE \"$query\";");

my ($hash, $enc);

# make sure need_unpack directory exists
unless (-d 'need_unpack') {
	make_path('need_unpack') or die "Failed to create need_unpack: $!";
}

# Catches a wrong $datadir (e.g. a stale suffix) here instead of failing silently below --
# File::Copy::copy's return value was previously unchecked, so this used to just leave
# need_unpack/ empty with no error at all.
-d $datadir or die "dat directory not found: $datadir (derived from '$meta')";

$select->execute;
$select->bind_columns(\($hash, $enc));

while ($select->fetch) {
	$hash =~ /^(..)/;
	my $hdir = $1;
	# Warn and skip rather than die: dat/ is often populated incrementally via
	# download-game-assets.mjs's --like patterns, so a query broader than what's been
	# downloaded so far is expected to have some misses -- one missing hash shouldn't
	# abort every subsequent match in the same run (PIPE-17 review, 2026-08-28). The
	# -d $datadir check above already catches the "wrong directory entirely" case this
	# was originally meant to guard against.
	unless (copy("$datadir/$hdir/$hash", "need_unpack/$hash")) {
		warn "Failed to copy $datadir/$hdir/$hash: $! -- skipping";
		next;
	}
	# write encryption key next to the extracted file if present
	if (defined $enc && length $enc) {
		open my $kf, '>', "need_unpack/$hash.key" or die "Unable to write key file: $!";
		binmode $kf;
		print $kf $enc;
		close $kf;
	}
}
