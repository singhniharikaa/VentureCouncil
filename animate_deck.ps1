# Adds entrance animations + slide transitions to VentureCouncil.pptx using PowerPoint itself.
# Shapes named "aNN_effect_label" play at step NN; shapes sharing a step play together.
# Every step plays automatically after the previous one, so each slide builds itself.
param([string]$Path = "$PSScriptRoot\VentureCouncil.pptx")

$effects = @{
  fade  = @{ id = 10; dir = 0; dur = 0.5 }   # msoAnimEffectFade
  zoom  = @{ id = 23; dir = 0; dur = 0.4 }   # msoAnimEffectZoom
  up    = @{ id = 2;  dir = 0; dur = 0.5 }   # msoAnimEffectFly, default from bottom
  flyL  = @{ id = 2;  dir = 4; dur = 0.5 }   # Fly from left
  flyR  = @{ id = 2;  dir = 2; dur = 0.5 }   # Fly from right
  wipeL = @{ id = 22; dir = 4; dur = 0.4 }   # msoAnimEffectWipe from left
}

$app = New-Object -ComObject PowerPoint.Application
$deck = $app.Presentations.Open($Path, $false, $false, $false)
foreach ($slide in $deck.Slides) {
  $seq = $slide.TimeLine.MainSequence
  while ($seq.Count -gt 0) { $seq.Item(1).Delete() }

  $items = @()
  $i = 0
  foreach ($sh in $slide.Shapes) {
    $i++
    if ($sh.Name -match '^a(\d\d)_(\w+?)_') { $items += [pscustomobject]@{ Shape = $sh; Step = [int]$matches[1]; Eff = $matches[2]; Z = $i } }
  }
  $prevStep = -1
  foreach ($it in ($items | Sort-Object Step, Z)) {
    $e = $effects[$it.Eff]
    $trigger = if ($it.Step -ne $prevStep) { 3 } else { 2 }   # AfterPrevious starts a step, WithPrevious joins it
    $fx = $seq.AddEffect($it.Shape, $e.id, 0, $trigger)
    if ($e.dir -ne 0) { $fx.EffectParameters.Direction = $e.dir }
    $fx.Timing.Duration = $e.dur
    $prevStep = $it.Step
  }
  $slide.SlideShowTransition.EntryEffect = 3849   # ppEffectFadeSmoothly
  $slide.SlideShowTransition.Duration = 0.7
  "Slide $($slide.SlideIndex): $($seq.Count) animations"
}
$deck.Save()
$deck.Close()
$app.Quit()
