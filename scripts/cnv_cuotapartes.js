jQuery.noConflict();
(function ($) {
    $(function () {
        $(document).ready(function () {
            $(".btn-leer-mas").on('click', function () {
                $(".js-FCI-Cuotapartes").show();
                $(this).remove();
            });
        });
    });
})(jQuery);