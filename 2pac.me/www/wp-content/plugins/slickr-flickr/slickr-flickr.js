var slickr_flickr_slideshow_timer;
var slickr_flickr_slideshow_timer_on = false;

function  slickr_flickr_next_slide(obj) {
    var j = jQuery(obj);
    if (j.children('div').length == 1)  return ;
    options = j.data("options");    
    var $active = j.children('div.active');
    if ( $active.length == 0 ) $active = j.children('div:last');
    var $next =  $active.next().length ? $active.next() : j.children('div:first');

    $active.addClass('last-active');
    $next.css({opacity: 0.0})
        .addClass('active')
        .animate({opacity: 1.0}, options['transition'], function() {
            $active.removeClass('active last-active');
        });
}

function slickr_flickr_next_slides() {
   jQuery('.slickr-flickr-slideshow').each(function(index){
        slickr_flickr_next_slide(jQuery(this)) ;
   });
}

function  slickr_flickr_set_slideshow_height(slideshow,imgheight,divheight) {
    var s = jQuery(slideshow);
    s.find('div img').css("max-height",imgheight+"px");
    s.css("height", divheight+"px");
}    
function  slickr_flickr_set_slideshow_width(slideshow,width) {
    var s = jQuery(slideshow);
    s.find('div img').css("max-width",width+"px");
    s.css("width",width+"px");
} 

function  slickr_flickr_set_slideshow_click(slideshow,link) {
    var s = jQuery(slideshow);
    if (link=='next') 
    	s.unbind('click').click( function() {  slickr_flickr_next_slide(s) ; });
	else if (link=='toggle') 
		s.unbind('click').click( function() {  slickr_flickr_toggle_slideshows() ; });
	else 
	    s.unbind('click').click( function() {  window.location = link.replace(/\\/g, ''); }); 
}

function  slickr_flickr_get_slideshow_delay() {
   var mindelay = 0;
   jQuery('.slickr-flickr-slideshow').each(function(index){
        var s =jQuery(this);
   		options = s.data('options');
    	if ('delay' in options) delay = options['delay'];
    	if ((!(delay == undefined)) && ((mindelay == 0) || (delay < mindelay))) mindelay = delay;
    	if ('link' in options)  slickr_flickr_set_slideshow_click(s,options['link']);
    	if ('width' in options)  slickr_flickr_set_slideshow_width(s,options['width']);
     	if ('height' in options)  {
     		imgheight = parseInt(options['height']);
     		divheight = imgheight+40;
     		if (s.hasClass("descriptions")) divheight += 50;
 	    	slickr_flickr_set_slideshow_height(s,imgheight,divheight);
 		}
 });
   return mindelay;
}


function slickr_flickr_toggle_slideshows() {
   if (slickr_flickr_slideshow_timer_on)
       slickr_flickr_stop_slideshows();
   else
       slickr_flickr_start_slideshows();
}

function slickr_flickr_stop_slideshows() {
    clearTimeout(slickr_flickr_slideshow_timer);
    slickr_flickr_slideshow_timer_on = false;
}

function slickr_flickr_start_slideshows() {
	var flickr_slideshow_delay =  slickr_flickr_get_slideshow_delay();
	if (flickr_slideshow_delay > 0) {
	    slickr_flickr_slideshow_timer = setInterval("slickr_flickr_next_slides()",flickr_slideshow_delay);
	    slickr_flickr_slideshow_timer_on = true;
    }
}

jQuery.noConflict(); jQuery(document).ready(function($) {
    $(".slickr-flickr-galleria").each(function($index){
        var $options = $(this).data("options");
        $(this).galleria($options);
    });
    if ($('a[rel="sf-lightbox"]').size() > 0) {
        $(".slickr-flickr-gallery,.slickr-flickr-slideshow").each( function (index) {
            $options = $(this).data("options");
            $(this).find('a[rel="sf-lightbox"]').lightBox($options);
        });
    }   
    slickr_flickr_start_slideshows();
});