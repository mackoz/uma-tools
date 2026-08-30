use strict;
use warnings;
use v5.012;

use DBI;
use DBD::SQLite::Constants qw(:file_open);
use JSON::PP;

if (!@ARGV) {
	die 'Usage: make_skill_meta.pl master.mdb';
}

my $mastermdb = shift @ARGV;

my $db = DBI->connect("dbi:SQLite:$mastermdb", undef, undef, {
	sqlite_open_flags => SQLITE_OPEN_READONLY
});
$db->{RaiseError} = 1;

my $select = $db->prepare(<<SQL
   SELECT s.id, COALESCE(s3.group_id, s2.group_id, s.group_id), s.icon_id, COALESCE(sp.need_skill_point,0), s.disp_order, s.group_rate
     FROM skill_data s
LEFT JOIN single_mode_skill_need_point sp
       ON s.id = sp.id
LEFT JOIN (skill_upgrade_speciality u INNER JOIN skill_data s2 ON s2.id = u.base_skill_id)
       ON s.id = u.skill_id
LEFT JOIN (skill_upgrade_description p
           INNER JOIN available_skill_set a
                   ON p.card_id = a.available_skill_set_id AND p.rank = a.need_rank
           INNER JOIN skill_data s3
                   ON s3.id = a.skill_id)
       ON s.id = p.skill_id
    WHERE s.is_general_skill = 1 OR s.rarity >= 3;
SQL
);

$select->execute;

my ($id, $group_id, $icon_id, $sp_cost, $disp_order, $group_rate);

$select->bind_columns(\($id, $group_id, $icon_id, $sp_cost, $disp_order, $group_rate));

my $skills = {};
while ($select->fetch) {
	# groupRate is the skill's own rank within its (possibly remapped, see groupId above) upgrade
	# family -- taken from `s` (the skill itself), NOT the coalesced group source, since the remap
	# exists to place a skill in the right family while the rate describes the skill's own rung.
	# UI-28: drives the Skill Chart shop-skill shortlist's automatic prerequisite selection --
	# adding a skill also adds every same-group skill with 1 <= groupRate < this one's, guarded by
	# rarity <= 2 in the consuming code (umalator/app.tsx) so remapped rarity-6 (evolved) skills
	# sharing a groupId with a white/gold ladder are never treated as prerequisites. -1 is the
	# debuff/"x" variant and must never be auto-added, though it's already excluded from the chart
	# pool upstream by isPurpleSkill.
	$skills->{$id} = {groupId => "$group_id", iconId => "$icon_id", baseCost => $sp_cost, order => $disp_order, groupRate => $group_rate};
}

my $json = JSON::PP->new;
$json->canonical(1);
say $json->encode($skills);
