use strict;
use warnings;
use v5.012;

use DBI;
use DBD::SQLite::Constants qw(:file_open);
use JSON::PP;

if (!@ARGV) {
	die 'Usage: make_global_skill_meta.pl master.mdb';
}

my $mastermdb = shift @ARGV;

my $db = DBI->connect("dbi:SQLite:$mastermdb", undef, undef, {
	sqlite_open_flags => SQLITE_OPEN_READONLY
});
$db->{RaiseError} = 1;

my $select = $db->prepare(<<SQL
   SELECT s.id, s.group_id, s.icon_id, COALESCE(sp.need_skill_point,0), s.disp_order, s.group_rate
     FROM skill_data s
LEFT JOIN single_mode_skill_need_point sp
       ON s.id = sp.id
    WHERE s.is_general_skill = 1 OR s.rarity >= 3;
SQL
);

$select->execute;

my ($id, $group_id, $icon_id, $sp_cost, $disp_order, $group_rate);

$select->bind_columns(\($id, $group_id, $icon_id, $sp_cost, $disp_order, $group_rate));

my $skills = {};
while ($select->fetch) {
	# groupRate: see make_skill_meta.pl's fuller comment (JP has no groupId remap here, so this is
	# a straight s.group_rate with no ambiguity about which side to read it from). UI-28.
	$skills->{$id} = {groupId => "$group_id", iconId => "$icon_id", baseCost => $sp_cost, order => $disp_order, groupRate => $group_rate};
}

my $json = JSON::PP->new;
$json->canonical(1);
say $json->encode($skills);
